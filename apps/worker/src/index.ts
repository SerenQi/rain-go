import { GAMES, describeMatch, isGameKind, seatByToken, viewMatch, type Match, type MatchAction, type SeatKind } from "@rain-go/engine";
import { Hono } from "hono";
import { authorized, gameOfToken, isGameId, lobbyOf, newGameId, newSeatToken, roomOf, seatByWatch, type Env } from "./env";
import { handleMcp } from "./mcp";
import { buildSeats, invitesOf } from "./seats";

export { GameRoom } from "./game-room";
export { Lobby } from "./lobby";

const app = new Hono<{ Bindings: Env }>();

const unauthorized = () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
/** A seat token from the `x-seat` header or the `t` query parameter. */
const seatTokenOf = (req: Request) => req.headers.get("x-seat") ?? new URL(req.url).searchParams.get("t");

app.get("/api/config", (c) => c.json({ authRequired: Boolean(c.env.ACCESS_TOKEN) }));

app.get("/api/auth", (c) => (authorized(c.env, c.req.raw) ? c.json({ ok: true }) : unauthorized()));

app.get("/api/games", async (c) => {
  if (!authorized(c.env, c.req.raw)) return unauthorized();
  return c.json({ games: await lobbyOf(c.env).list(50, true) });
});

app.post("/api/games", async (c) => {
  if (!authorized(c.env, c.req.raw)) return unauthorized();
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const kind = body.kind ?? "go";
  if (!isGameKind(kind) || !GAMES[kind].ready) return c.json({ error: "bad_kind", message: "没有这个游戏" }, 400);
  const id = newGameId();
  const built = buildSeats(kind, id, body.seats);
  if ("error" in built) return c.json({ error: "bad_seats", message: built.error }, 400);
  if (body.informationMode === "equal" && (kind !== "gomoku" || built.seats.some((s) => s.kind !== "ai"))) {
    return c.json({ error: "bad_mode", message: "对等信息模式仅支持两个 AI 座位的五子棋" }, 400);
  }
  // The host of a room may sit in it or only run it, but only in a human seat.
  if (body.room === true && built.mine !== null && built.seats[built.mine]!.kind !== "human") {
    return c.json({ error: "bad_seats", message: "房主只能坐真人座位" }, 400);
  }
  const hostToken = body.room === true ? newSeatToken(id) : undefined;
  const match = await roomOf(c.env, id).create({
    id,
    kind,
    informationMode: body.informationMode === "equal" ? "equal" : undefined,
    options: typeof body.options === "object" && body.options ? (body.options as Record<string, unknown>) : {},
    seats: built.seats,
    seed: crypto.getRandomValues(new Uint32Array(1))[0]!,
    now: Date.now(),
    hostToken,
    host: hostToken && built.mine !== null ? built.mine : undefined,
  });
  const origin = new URL(c.req.url).origin;
  return c.json(
    {
      match: viewMatch(match, built.mine),
      token: built.mine === null ? null : match.seats[built.mine]!.token,
      hostToken: hostToken ?? null,
      invites: invitesOf(match, origin),
    },
    201,
  );
});

app.get("/api/games/:id", async (c) => {
  const id = c.req.param("id");
  if (!isGameId(id)) return c.json({ error: "bad_id" }, 400);
  const match = await roomOf(c.env, id).get();
  if (!match) return c.json({ error: "not_found" }, 404);
  const watch = c.req.header("x-watch");
  const seat = watch ? await seatByWatch(match, watch) : seatByToken(match, seatTokenOf(c.req.raw));
  return c.json({ match: viewMatch(match, seat) });
});

/** The site owner or the room's host: every seat with its invite link, e.g. to send a friend their seat. */
app.get("/api/games/:id/invites", async (c) => {
  const id = c.req.param("id");
  if (!isGameId(id)) return c.json({ error: "bad_id" }, 400);
  const match = await roomOf(c.env, id).get();
  if (!match) return c.json({ error: "not_found" }, 404);
  if (!isHost(match, c.req.raw) && !authorized(c.env, c.req.raw)) return unauthorized();
  return c.json({ invites: invitesOf(match, new URL(c.req.url).origin), tokens: match.seats.map((s) => (s.kind === "human" ? s.token : null)) });
});

const ACTION_TYPES = new Set(["move", "resign", "say", "rename"]);
const SEAT_KINDS = new Set<SeatKind>(["human", "ai", "bot"]);

/** The human seat a request's `x-seat` token holds, or an error response. */
async function humanSeat(env: Env, id: string, req: Request) {
  if (!isGameId(id)) return { error: Response.json({ error: "bad_id" }, { status: 400 }) };
  const token = seatTokenOf(req);
  if (gameOfToken(token) !== id) return { error: Response.json({ error: "no_seat", message: "你没有这一局的座位" }, { status: 403 }) };
  const room = roomOf(env, id);
  const match = await room.get();
  if (!match) return { error: Response.json({ error: "not_found" }, { status: 404 }) };
  const seat = seatByToken(match, token);
  if (seat === null || match.seats[seat]!.kind !== "human") return { error: Response.json({ error: "no_seat", message: "你没有这一局的座位" }, { status: 403 }) };
  return { room, match, seat };
}

/** The room's host token, from the `x-host` header; compared in constant time. */
function isHost(match: Match, req: Request): boolean {
  const given = req.headers.get("x-host") ?? "";
  if (!match.hostToken || given.length !== match.hostToken.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ match.hostToken.charCodeAt(i);
  return diff === 0;
}

async function hostRoom(env: Env, id: string, req: Request) {
  if (!isGameId(id)) return { error: Response.json({ error: "bad_id" }, { status: 400 }) };
  const room = roomOf(env, id);
  const match = await room.get();
  if (!match) return { error: Response.json({ error: "not_found" }, { status: 404 }) };
  if (!isHost(match, req)) return { error: Response.json({ error: "not_host", message: "只有房主能这样做" }, { status: 403 }) };
  return { room, match };
}

/**
 * Host only, while waiting: give seat i to a friend ("human"), an AI over MCP ("ai") or a bot.
 * `joined` with "human" seats one of the host's own API bots, which the host's browser plays;
 * `host` with "human" seats the host themself. The host's own seat can be given away too.
 */
app.post("/api/games/:id/seats", async (c) => {
  const g = await hostRoom(c.env, c.req.param("id"), c.req.raw);
  if ("error" in g) return g.error;
  type Body = { seat?: unknown; kind?: unknown; name?: unknown; avatar?: unknown; joined?: unknown; host?: unknown };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  if (typeof body.seat !== "number" || !SEAT_KINDS.has(body.kind as SeatKind)) return c.json({ error: "bad_seat" }, 400);
  const res = await g.room.setSeat(body.seat, body.kind as SeatKind, {
    name: typeof body.name === "string" ? body.name : undefined,
    avatar: typeof body.avatar === "string" ? body.avatar : undefined,
    joined: body.joined === true,
    host: body.host === true,
  });
  if (!res.ok) return c.json(res, 409);
  return c.json({ match: viewMatch(res.match, res.match.host ?? null), invites: invitesOf(res.match, new URL(c.req.url).origin) });
});

/** Host, or the holder of that seat's watch link: time the AI in an MCP seat on a late practice position. */
app.post("/api/games/:id/bench", async (c) => {
  const id = c.req.param("id");
  if (!isGameId(id)) return c.json({ error: "bad_id" }, 400);
  const room = roomOf(c.env, id);
  const match = await room.get();
  if (!match) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json<{ seat?: unknown }>().catch(() => ({}) as { seat?: unknown });
  if (typeof body.seat !== "number") return c.json({ error: "bad_seat" }, 400);
  const watch = c.req.header("x-watch");
  const watcher = watch ? (await seatByWatch(match, watch)) === body.seat : false;
  if (!watcher && !isHost(match, c.req.raw)) return c.json({ error: "not_allowed", message: "只有房主或这个座位的主人能测" }, 403);
  const res = await room.requestBench(body.seat);
  return res.ok ? c.json({ ok: true }) : c.json(res, 409);
});

app.post("/api/games/:id/start", async (c) => {
  const g = await hostRoom(c.env, c.req.param("id"), c.req.raw);
  if ("error" in g) return g.error;
  const res = await g.room.start();
  return res.ok ? c.json({ match: viewMatch(res.match, res.match.host ?? null) }) : c.json(res, 409);
});

/** The plain-text table for a human seat, so a model in that person's browser can play for them. */
app.get("/api/games/:id/describe", async (c) => {
  const g = await humanSeat(c.env, c.req.param("id"), c.req.raw);
  if ("error" in g) return g.error;
  c.header("Cache-Control", "no-store");
  return c.json({ text: describeMatch(g.match, g.seat), moveHelp: GAMES[g.match.kind].moveHelp, version: g.match.version });
});

/** Acting needs the seat's own token; human seats only (AI seats act over MCP). */
app.post("/api/games/:id/actions", async (c) => {
  const id = c.req.param("id");
  if (!isGameId(id)) return c.json({ error: "bad_id" }, 400);
  const token = seatTokenOf(c.req.raw);
  if (gameOfToken(token) !== id) return c.json({ error: "no_seat", message: "你没有这一局的座位" }, 403);
  const room = roomOf(c.env, id);
  const match = await room.get();
  if (!match) return c.json({ error: "not_found" }, 404);
  const seat = seatByToken(match, token);
  if (seat === null || match.seats[seat]!.kind !== "human") return c.json({ error: "no_seat", message: "你没有这一局的座位" }, 403);
  const action = await c.req.json<MatchAction>().catch(() => null);
  if (!action || typeof action !== "object" || !ACTION_TYPES.has(action.type)) return c.json({ error: "bad_action" }, 400);
  const res = await room.act(seat, action);
  return res.ok ? c.json({ match: viewMatch(res.match, seat) }) : c.json(res, 409);
});

app.get("/api/games/:id/ws", async (c) => {
  const id = c.req.param("id");
  if (!isGameId(id)) return c.json({ error: "bad_id" }, 400);
  return roomOf(c.env, id).fetch(c.req.raw);
});

/** Browser-run arena: the server sees only seat tokens and moves, never model API keys. */
app.post("/api/arena/games", async (c) => {
  const origin = c.req.header("origin");
  const publicOrigin = c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin;
  if (origin && origin !== publicOrigin) return c.json({ error: "bad_origin" }, 403);
  if (!c.env.ACCESS_TOKEN || !authorized(c.env, c.req.raw)) {
    if (c.env.PUBLIC_ARENA !== "1") return c.json({ error: "closed", message: "这个站点尚未开放公开开局" }, 403);
    if (!(await lobbyOf(c.env).reservePublicArena())) return c.json({ error: "rate_limit", message: "开局暂时达到限制，请稍后再试" }, 429);
  }
  const body = await c.req.json<{ names?: unknown }>().catch(() => ({} as { names?: unknown }));
  const names = Array.isArray(body.names) ? body.names : [];
  const id = newGameId();
  const built = buildSeats("gomoku", id, [0, 1].map((i) => ({ kind: "ai", name: typeof names[i] === "string" ? names[i].slice(0, 40) : undefined })));
  if ("error" in built) return c.json({ error: "bad_seats", message: built.error }, 400);
  const match = await roomOf(c.env, id).create({ id, kind: "gomoku", informationMode: "equal", seats: built.seats, seed: crypto.getRandomValues(new Uint32Array(1))[0]!, now: Date.now() });
  return c.json({ match: viewMatch(match, null), invites: invitesOf(match, publicOrigin) }, 201);
});

const arenaSeat = async (env: Env, id: string, token: string | null) => {
  if (!isGameId(id) || gameOfToken(token) !== id) return null;
  const room = roomOf(env, id);
  const match = await room.get();
  if (!match || match.kind !== "gomoku" || match.informationMode !== "equal") return null;
  const seat = seatByToken(match, token);
  if (seat === null || match.seats[seat]?.kind !== "ai") return null;
  return { room, match, seat };
};
app.get("/api/arena/:id/state", async (c) => {
  const g = await arenaSeat(c.env, c.req.param("id"), c.req.header("x-seat") ?? null);
  if (!g) return c.json({ error: "no_seat" }, 403);
  c.header("Cache-Control", "no-store");
  return c.json({ state: describeMatch(g.match, g.seat) });
});
app.post("/api/arena/:id/join", async (c) => {
  const origin = c.req.header("origin");
  if (origin && origin !== (c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin)) return c.json({ error: "bad_origin" }, 403);
  const g = await arenaSeat(c.env, c.req.param("id"), c.req.header("x-seat") ?? null);
  if (!g) return c.json({ error: "no_seat" }, 403);
  const body = await c.req.json<{ name?: unknown }>().catch(() => ({} as { name?: unknown }));
  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 40) return c.json({ error: "bad_name", message: "名称要在 1 到 40 字以内" }, 400);
  const result = await g.room.act(g.seat, { type: "rename", name: body.name });
  return result.ok ? c.json({ state: describeMatch(result.match, g.seat) }) : c.json({ error: result.error, message: result.message }, 409);
});
app.post("/api/arena/:id/move", async (c) => {
  const origin = c.req.header("origin");
  if (origin && origin !== (c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin)) return c.json({ error: "bad_origin" }, 403);
  const g = await arenaSeat(c.env, c.req.param("id"), c.req.header("x-seat") ?? null);
  if (!g) return c.json({ error: "no_seat" }, 403);
  const body = await c.req.json<{ move?: unknown }>().catch(() => ({} as { move?: unknown }));
  if (typeof body.move !== "string" || body.move.length > 8) return c.json({ error: "bad_move" }, 400);
  const result = await g.room.act(g.seat, { type: "move", move: body.move });
  return result.ok ? c.json({ state: describeMatch(result.match, g.seat) }) : c.json({ error: "illegal", message: result.message }, 409);
});

const mcp = async (req: Request, env: Env, token?: string) => {
  if (!authorized(env, req, token)) return unauthorized();
  return handleMcp(req, env, env.PUBLIC_ORIGIN ?? new URL(req.url).origin, { mode: "owner" });
};
app.all("/mcp", (c) => mcp(c.req.raw, c.env));
/** A connector for one AI seat only: it can play that seat and nothing else. */
app.all("/mcp/seat/:seatToken", (c) => {
  const token = c.req.param("seatToken");
  if (!gameOfToken(token)) return unauthorized();
  return handleMcp(c.req.raw, c.env, c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin, { mode: "seat", token });
});
/** One stable connector per site for players: every call names its seat with the seat code. */
app.all("/mcp/play", (c) => handleMcp(c.req.raw, c.env, c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin, { mode: "play" }));
app.all("/mcp/:token", (c) => mcp(c.req.raw, c.env, c.req.param("token")));

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
