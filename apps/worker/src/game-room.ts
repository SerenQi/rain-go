import { DurableObject } from "cloudflare:workers";
import {
  GAMES,
  applyMatchAction,
  createMatch,
  joinSeat,
  seatByToken,
  setSeatKind,
  startMatch,
  statusOf,
  viewMatch,
  type Match,
  type MatchAction,
  type NewMatchOptions,
  type Seat,
  type SeatKind,
} from "@rain-go/engine";
import { lobbyOf, newSeatToken, seatByWatch, type Env } from "./env";
import type { GameMeta } from "./lobby";

export type ActResult = { ok: true; match: Match } | { ok: false; error: string; message: string };

/**
 * One Durable Object per game. Each WebSocket is bound to a seat (or to a spectator) and only
 * ever receives that seat's view, so hidden cards never leave the server.
 */
export class GameRoom extends DurableObject<Env> {
  private match: Match | null | undefined;
  private waiters = new Set<() => void>();

  private async load(): Promise<Match | null> {
    if (this.match === undefined) this.match = (await this.ctx.storage.get<Match>("match")) ?? null;
    return this.match;
  }

  private async save(m: Match): Promise<void> {
    this.match = m;
    await this.ctx.storage.put("match", m);
    for (const ws of this.ctx.getWebSockets()) {
      const seat = (ws.deserializeAttachment() as { seat: Seat | null } | null)?.seat ?? null;
      try {
        ws.send(JSON.stringify({ type: "match", match: viewMatch(m, seat) }));
      } catch {
        // Socket already closing.
      }
    }
    for (const wake of this.waiters) wake();
    this.waiters.clear();
    await lobbyOf(this.env).upsert(metaOf(m));
  }

  async create(o: NewMatchOptions): Promise<Match> {
    if (await this.load()) throw new Error("Game already exists");
    const m = createMatch(o);
    await this.save(m);
    return m;
  }

  async get(): Promise<Match | null> {
    return this.load();
  }

  async act(seat: Seat, action: MatchAction): Promise<ActResult> {
    const m = await this.load();
    if (!m) return { ok: false, error: "not_found", message: "找不到这局" };
    const res = applyMatchAction(joinSeat(m, seat, Date.now()), seat, action, Date.now());
    if (!res.ok) return res;
    await this.save(res.match);
    return { ok: true, match: res.match };
  }

  /** Host only, while the room is waiting: invite a friend, an AI or a bot into a seat, or move the host. */
  async setSeat(seat: Seat, kind: SeatKind, profile: { name?: unknown; avatar?: unknown; joined?: boolean; host?: boolean } = {}): Promise<ActResult> {
    const m = await this.load();
    if (!m) return { ok: false, error: "not_found", message: "找不到这局" };
    const res = setSeatKind(m, seat, kind, newSeatToken(m.id), Date.now(), profile);
    if (!res.ok) return res;
    await this.save(res.match);
    return { ok: true, match: res.match };
  }

  /** Host only: starts a waiting room once every seat is taken. */
  async start(): Promise<ActResult> {
    const m = await this.load();
    if (!m) return { ok: false, error: "not_found", message: "找不到这局" };
    const res = startMatch(m, Date.now());
    if (!res.ok) return res;
    await this.save(res.match);
    return { ok: true, match: res.match };
  }

  async join(seat: Seat): Promise<Match | null> {
    const m = await this.load();
    if (!m || !m.seats[seat]) return m;
    const next = joinSeat(m, seat, Date.now());
    if (next !== m) await this.save(next);
    return next;
  }

  /** Resolves once the game waits on `seat`, the game ends, or the timeout passes. */
  async waitFor(seat: Seat, timeoutMs: number): Promise<{ match: Match | null; timedOut: boolean }> {
    const deadline = Date.now() + Math.min(Math.max(timeoutMs, 0), 58_000);
    for (;;) {
      const m = await this.load();
      if (!m) return { match: null, timedOut: false };
      const st = statusOf(m);
      if (st.outcome || st.waitingOn.includes(seat)) return { match: m, timedOut: false };
      const left = deadline - Date.now();
      if (left <= 0) return { match: m, timedOut: true };
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.add(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    let m = await this.load();
    const q = new URL(req.url).searchParams;
    // A watch link sees its seat's view but never takes the seat.
    const watched = m && q.has("w") ? await seatByWatch(m, q.get("w")) : null;
    const seat = watched ?? (m ? seatByToken(m, q.get("t")) : null);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seat });
    if (m && watched === null && seat !== null && m.seats[seat]?.kind === "human" && !m.seats[seat]!.joined) {
      m = joinSeat(m, seat, Date.now());
      await this.save(m);
    }
    server.send(JSON.stringify(m ? { type: "match", match: viewMatch(m, seat) } : { type: "error", message: "找不到这局" }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === "ping") ws.send("pong");
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code, "bye");
    } catch {
      // Already closed.
    }
  }
}

export function metaOf(m: Match): GameMeta {
  const st = statusOf(m);
  return {
    id: m.id,
    kind: m.kind,
    seats: m.seats.map(({ token: _t, ...s }) => s),
    labels: GAMES[m.kind].seatLabels(m.state),
    over: Boolean(st.outcome),
    ...(m.waiting ? { waiting: true } : {}),
    waitingOn: st.waitingOn,
    moves: m.log.length,
    result: st.resultText ?? undefined,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}
