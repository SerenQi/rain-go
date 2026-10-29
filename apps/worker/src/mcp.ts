import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { GAMES, describeMatch, openSeat, readyGames, seatByToken, type Match, type MatchAction, type Seat } from "@rain-go/engine";
import { z } from "zod";
import { gameOfToken, isGameId, lobbyOf, newGameId, roomOf, watchTokenOf, type Env } from "./env";
import { buildSeats, invitesOf } from "./seats";

export type McpContext = { mode: "owner" } | { mode: "seat"; token: string };

const INSTRUCTIONS = `West Window (西窗): board, card and dice games for humans, AIs and bots around one table. Humans play on a live web page; AIs play through these tools.

Flow:
1. list_game_types shows each game's rules, seat counts and options. new_game creates a table (you take an AI seat) and returns links: send each human their own page link; other AIs can join with join_game or with their seat's own connector URL.
2. When it is your turn call play with a move in that game's syntax (every state repeats the syntax).
3. Otherwise call wait_for_opponent. It blocks up to ~50s; call it again if it times out.
4. get_state shows the table at any time. Card games only show your own hand.
If a game has more than one AI seat, pass your seat token as "seat" in every call. You may talk to the table with the "say" argument of play or with say; keep it short and warm.`;

const SEAT_INSTRUCTIONS = `West Window (西窗): this connector plays exactly one seat at one game table. Call get_state, then play on your turn or wait_for_opponent otherwise. The state repeats the move syntax. The state also has a read-only watch link for your seat: give it to your person once.`;

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], isError });

export function buildMcpServer(env: Env, origin: string, ctx: McpContext): McpServer {
  const owner = ctx.mode === "owner";
  const server = new McpServer(
    { name: "rain-go", version: "0.3.0" },
    { instructions: owner ? INSTRUCTIONS : SEAT_INSTRUCTIONS, jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
  const pageOf = (id: string) => `${origin}/g/${id}`;
  /** The state for an AI seat, with the read-only link to that seat's own view. */
  const describe = async (m: Match, seat: Seat) => describeMatch(m, seat, `${pageOf(m.id)}?w=${await watchTokenOf(m.seats[seat]!.token)}`);

  /** Finds the game and the AI seat a call acts for. */
  const resolve = async (args: { game_id?: string; seat?: string }): Promise<{ id: string; match: Match; seat: Seat } | { error: string }> => {
    const token = ctx.mode === "seat" ? ctx.token : args.seat?.trim() || undefined;
    let id = token ? gameOfToken(token) : args.game_id?.trim();
    if (token && !id) return { error: "That seat token is not valid." };
    if (!id) {
      const [latest] = await lobbyOf(env).list(1, false);
      if (!latest) return { error: "No active game. Start one with new_game." };
      id = latest.id;
    }
    if (!isGameId(id)) return { error: `Invalid game id "${id}".` };
    let match = await roomOf(env, id).get();
    if (!match) return { error: `Game ${id} not found.` };
    if (token) {
      const seat = seatByToken(match, token);
      if (seat === null || match.seats[seat]!.kind !== "ai") return { error: "That seat token does not belong to an AI seat in this game." };
      // Connecting is what takes the seat, so a waiting room sees the AI arrive before its first move.
      if (!match.seats[seat]!.joined) match = (await roomOf(env, id).join(seat)) ?? match;
      return { id, match, seat };
    }
    const aiSeats = match.seats.map((s, i) => (s.kind === "ai" ? i : -1)).filter((i) => i >= 0);
    if (aiSeats.length === 1) return { id, match, seat: aiSeats[0]! };
    if (!aiSeats.length) return { error: `Game ${id} has no AI seat.` };
    return { error: `Game ${id} has ${aiSeats.length} AI seats (${aiSeats.join(", ")}). Pass your seat token as "seat", or call join_game to take a free one.` };
  };

  const scope = {
    game_id: z
      .string()
      .optional()
      .describe(owner ? "Game id. Omit to use the most recently active unfinished game." : "Ignored: this connector is bound to one seat."),
    seat: z
      .string()
      .optional()
      .describe(owner ? "Your seat token. Needed only when the game has more than one AI seat." : "Ignored: this connector is bound to one seat."),
  };

  const act = async (args: { game_id?: string; seat?: string }, actions: MatchAction[]) => {
    const g = await resolve(args);
    if ("error" in g) return text(g.error, true);
    let match = g.match;
    for (const a of actions) {
      const res = await roomOf(env, g.id).act(g.seat, a);
      if (!res.ok) return text(`Not allowed: ${res.message}\n\n${await describe(match, g.seat)}`, true);
      match = res.match;
    }
    return text(await describe(match, g.seat));
  };

  if (owner) {
    server.registerTool(
      "list_game_types",
      { title: "List game types", description: "Games you can start, with seat counts, options and full rules.", inputSchema: {}, annotations: { readOnlyHint: true } },
      async () =>
        text(
          readyGames()
            .map((g) => {
              const n = g.players.min === g.players.max ? `${g.players.min}` : `${g.players.min}-${g.players.max}`;
              const opts = g.options.length
                ? ` Options: ${g.options.map((o) => `${o.key} = ${o.choices.map((c) => c.value).join(" | ")} (default ${o.default})`).join("; ")}.`
                : "";
              return `## ${g.kind} · ${g.name.en} (${g.name.zh}) · ${n} players${g.bot ? " · bots available" : ""}\n${g.rules}${opts}\nMove syntax: ${g.moveHelp}`;
            })
            .join("\n\n"),
        ),
    );

    server.registerTool(
      "new_game",
      {
        title: "Start a new game",
        description:
          'Create a table. `seats` lists who sits where in turn order ("human", "ai", "bot"); by default one human, you, and bots or humans up to the usual table size. You take the first AI seat unless `you` says otherwise.',
        inputSchema: {
          kind: z.enum(readyGames().map((g) => g.kind) as [string, ...string[]]),
          options: z.record(z.string(), z.string()).optional().describe('Game options, e.g. {"size": "13"} for go.'),
          seats: z.array(z.enum(["human", "ai", "bot"])).optional().describe('Seat kinds in turn order, e.g. ["human", "ai", "bot"]. Seat 0 moves first.'),
          you: z.number().int().min(0).optional().describe("Index of your own seat (must be an AI seat). Default: the first AI seat."),
          names: z.array(z.string().max(40)).optional().describe("Display names per seat, in seat order."),
        },
      },
      async ({ kind, options, seats, you, names }) => {
        const k = kind as Match["kind"];
        const id = newGameId();
        const kinds = seats ?? undefined;
        const built = buildSeats(k, id, kinds?.map((s, i) => ({ kind: s, name: names?.[i] })));
        if ("error" in built) return text(built.error, true);
        const mySeat = you ?? built.seats.findIndex((s) => s.kind === "ai");
        if (mySeat < 0 || built.seats[mySeat]?.kind !== "ai") return text("Your seat must be an AI seat.", true);
        const specs = built.seats.map((s, i) => ({ ...s, name: names?.[i] ?? s.name, joined: i === mySeat }));
        const match = await roomOf(env, id).create({ id, kind: k, options, seats: specs, seed: crypto.getRandomValues(new Uint32Array(1))[0]!, now: Date.now() });
        const inv = invitesOf(match, origin);
        const lines = [`New ${GAMES[k].name.en} table created.`];
        for (const i of inv) {
          if (i.seat === mySeat) lines.push(`- seat ${i.seat} ${i.name}: you. Your seat token: ${match.seats[mySeat]!.token}`);
          else if (i.kind === "human") lines.push(`- seat ${i.seat} ${i.name} (human): send them this link: ${i.link}`);
          else if (i.kind === "ai") lines.push(`- seat ${i.seat} ${i.name} (AI): another AI joins with join_game, or with this connector URL: ${i.link}`);
          else lines.push(`- seat ${i.seat} ${i.name}: bot, plays by itself`);
        }
        lines.push("", `Rules: ${GAMES[k].rules}`, "", await describe(match, mySeat));
        return text(lines.join("\n"));
      },
    );

    server.registerTool(
      "join_game",
      {
        title: "Join a game",
        description: "Take a free AI seat at a table. Returns your seat token; pass it as `seat` in later calls.",
        inputSchema: { game_id: z.string().describe("Game id (see list_games).") },
      },
      async ({ game_id }) => {
        if (!isGameId(game_id)) return text(`Invalid game id "${game_id}".`, true);
        const room = roomOf(env, game_id);
        const m = await room.get();
        if (!m) return text(`Game ${game_id} not found.`, true);
        const seat = openSeat(m, "ai");
        if (seat === null) return text("This table has no free AI seat.", true);
        const joined = (await room.join(seat)) ?? m;
        return text(`You took seat ${seat}. Your seat token: ${m.seats[seat]!.token} (pass it as "seat" in every call).\n\n${await describe(joined, seat)}`);
      },
    );

    server.registerTool(
      "list_games",
      { title: "List games", description: "Recent tables with their seats and status.", inputSchema: { include_finished: z.boolean().default(false) }, annotations: { readOnlyHint: true } },
      async ({ include_finished }) => {
        const games = await lobbyOf(env).list(20, include_finished);
        if (!games.length) return text("No games yet. Start one with new_game.");
        return text(
          games
            .map((g) => {
              const seats = g.seats.map((s, i) => `${i}:${s.name}(${s.kind}${s.kind !== "bot" && !s.joined ? ", open" : ""})`).join(" ");
              const waiting = g.waitingOn.map((i) => g.seats[i]?.name).join(", ");
              return `- ${g.id} · ${GAMES[g.kind]?.name.en ?? g.kind} · ${g.result ?? `waiting on ${waiting}`} · ${g.moves} moves · seats ${seats} · ${pageOf(g.id)}`;
            })
            .join("\n"),
        );
      },
    );
  }

  server.registerTool(
    "get_state",
    { title: "Show the game", description: "The table as your seat may see it, whose turn it is, and recent messages.", inputSchema: scope, annotations: { readOnlyHint: true } },
    async (args) => {
      const g = await resolve(args);
      if ("error" in g) return text(g.error, true);
      return text(await describe(g.match, g.seat));
    },
  );

  server.registerTool(
    "play",
    {
      title: "Make a move",
      description: "Make your move in the game's move syntax (shown in every state). Optionally say something to the table.",
      inputSchema: {
        ...scope,
        move: z.string().min(1).describe('The move, e.g. "D4", "e2e4", "call", "roll".'),
        say: z.string().max(280).optional().describe("A short message shown next to your move."),
      },
    },
    async ({ move, say, ...args }) => {
      const actions: MatchAction[] = [{ type: "move", move }];
      if (say?.trim()) actions.push({ type: "say", text: say });
      return act(args, actions);
    },
  );

  server.registerTool(
    "wait_for_opponent",
    {
      title: "Wait for your turn",
      description: "Block until it is your turn again or the game ends. Returns the state. If it says it timed out, call it again.",
      inputSchema: { ...scope, timeout_seconds: z.number().int().min(1).max(55).default(50) },
      annotations: { readOnlyHint: true },
    },
    async ({ timeout_seconds, ...args }) => {
      const g = await resolve(args);
      if ("error" in g) return text(g.error, true);
      const { match, timedOut } = await roomOf(env, g.id).waitFor(g.seat, timeout_seconds * 1000);
      if (!match) return text("Game disappeared.", true);
      const head = timedOut ? "Still waiting (timed out). Call wait_for_opponent again.\n\n" : "";
      return text(head + (await describe(match, g.seat)));
    },
  );

  server.registerTool(
    "resign",
    { title: "Resign", description: "Resign the game.", inputSchema: scope, annotations: { destructiveHint: true } },
    async (args) => act(args, [{ type: "resign" }]),
  );

  server.registerTool(
    "rename",
    {
      title: "Rename a seat",
      description: "Change a seat's display name (your own by default). The page updates at once.",
      inputSchema: { ...scope, name: z.string().min(1).max(40), seat_index: z.number().int().min(0).optional().describe("Seat to rename; default your own.") },
    },
    async ({ name, seat_index, ...args }) => act(args, [{ type: "rename", seat: seat_index, name }]),
  );

  server.registerTool(
    "say",
    { title: "Say something", description: "Send a short message to the table; it appears on everyone's page.", inputSchema: { ...scope, text: z.string().min(1).max(280) } },
    async ({ text: t, ...args }) => act(args, [{ type: "say", text: t }]),
  );

  return server;
}

/** Stateless Streamable HTTP: a fresh server and transport per request. */
export async function handleMcp(req: Request, env: Env, origin: string, ctx: McpContext): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }), {
      status: 405,
      headers: { "content-type": "application/json", allow: "POST" },
    });
  }
  const server = buildMcpServer(env, origin, ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(req);
}
