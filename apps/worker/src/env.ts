import type { Match, MatchAction, NewMatchOptions, Seat, SeatKind } from "@rain-go/engine";
import type { ActResult, GameRoom } from "./game-room";
import type { Lobby } from "./lobby";

export interface Env {
  GAME: DurableObjectNamespace<GameRoom>;
  LOBBY: DurableObjectNamespace<Lobby>;
  ASSETS: Fetcher;
  /** Shared secret for the MCP endpoint and for acting as the human player. Unset means open access. */
  ACCESS_TOKEN?: string;
  /** Explicitly enable unauthenticated browser arena creation. */
  PUBLIC_ARENA?: string;
  /** Canonical external origin when running behind a reverse proxy. */
  PUBLIC_ORIGIN?: string;
}

export const lobbyOf = (env: Env) => env.LOBBY.get(env.LOBBY.idFromName("main"));
/**
 * Typed handle to a game's Durable Object. Match.state is `unknown`, which the RPC type
 * mapping cannot express, so results are re-typed here once.
 */
export function roomOf(env: Env, id: string) {
  const stub = env.GAME.get(env.GAME.idFromName(id));
  return {
    create: (o: NewMatchOptions) => stub.create(o) as unknown as Promise<Match>,
    get: () => stub.get() as unknown as Promise<Match | null>,
    act: (seat: Seat, action: MatchAction) => stub.act(seat, action) as unknown as Promise<ActResult>,
    setSeat: (seat: Seat, kind: SeatKind, profile?: { name?: string; avatar?: string; joined?: boolean; host?: boolean }) =>
      stub.setSeat(seat, kind, profile) as unknown as Promise<ActResult>,
    start: () => stub.start() as unknown as Promise<ActResult>,
    requestBench: (seat: Seat) => stub.requestBench(seat) as unknown as Promise<ActResult>,
    benchFor: (seat: Seat) => stub.benchFor(seat) as unknown as Promise<Match | null>,
    answerBench: (seat: Seat, move: string) => stub.answerBench(seat, move) as unknown as Promise<{ ms: number; legal: boolean; message?: string } | null>,
    join: (seat: Seat) => stub.join(seat) as unknown as Promise<Match | null>,
    waitFor: (seat: Seat, ms: number) => stub.waitFor(seat, ms) as unknown as Promise<{ match: Match | null; timedOut: boolean }>,
    fetch: (req: Request) => stub.fetch(req),
  };
}

export function newGameId(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

export const isGameId = (s: string) => /^[a-z0-9]{6,32}$/.test(s);

/** Seat tokens start with the game id so a token alone finds its game: "<gameId>-<secret>". */
export function newSeatToken(gameId: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `${gameId}-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
export function gameOfToken(token: string | null | undefined): string | null {
  const m = token ? /^([a-z0-9]{6,32})-[0-9a-f]{32}$/.exec(token) : null;
  return m ? m[1]! : null;
}

/**
 * A read-only link for one seat: "<gameId>-w<hash>". It is a one-way hash of the seat token, so it
 * shows that seat's own cards but cannot be turned back into the token that acts for the seat.
 */
export async function watchTokenOf(seatToken: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`rain-go watch:${seatToken}`)));
  return `${gameOfToken(seatToken)}-w${[...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export const isWatchToken = (token: string | null | undefined): token is string => Boolean(token && /^[a-z0-9]{6,32}-w[0-9a-f]{32}$/.test(token));

/** The seat a watch token shows, or null. Bots have nothing to hide but nobody needs their view either. */
export async function seatByWatch(m: Match, token: string | null | undefined): Promise<Seat | null> {
  if (!isWatchToken(token) || !token.startsWith(`${m.id}-`)) return null;
  for (let i = 0; i < m.seats.length; i++) {
    if (m.seats[i]!.kind !== "bot" && safeEqual(await watchTokenOf(m.seats[i]!.token), token)) return i;
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Accepts the token as a Bearer header, a `token` query parameter, or an explicit value. */
export function authorized(env: Env, req: Request, explicit?: string): boolean {
  const expected = env.ACCESS_TOKEN;
  if (!expected) return true;
  const header = req.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
  const query = new URL(req.url).searchParams.get("token") ?? undefined;
  return [explicit, bearer, query].some((t) => t !== undefined && safeEqual(t, expected));
}
