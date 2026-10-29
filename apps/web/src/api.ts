import type { GameKind, MatchAction, MatchView, PublicSeat, Seat, SeatKind } from "@rain-go/engine";

const TOKEN_KEY = "rain-go:token";
const BG_KEY = "rain-go:bg";
const LAST_GAME_KEY = "rain-go:last-game";
const NAMES_KEY = "rain-go:names";
const LAST_NAMES_KEY = "rain-go:last-names";

const readJson = <T,>(k: string, fallback: T): T => {
  try {
    const v = JSON.parse(read(k) || "null") as T | null;
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

const read = (k: string) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};
const write = (k: string, v: string) => {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    // Storage unavailable (private mode); settings last for this visit only.
  }
};

export const prefs = {
  token: () => read(TOKEN_KEY),
  setToken: (v: string) => write(TOKEN_KEY, v.trim()),
  background: () => read(BG_KEY),
  setBackground: (v: string) => write(BG_KEY, v.trim()),
  lastGame: () => read(LAST_GAME_KEY),
  setLastGame: (v: string) => write(LAST_GAME_KEY, v),
  /** Recently used player names, newest first. */
  recentNames: (): string[] => readJson<string[]>(NAMES_KEY, []).filter((n) => typeof n === "string"),
  rememberNames: (...names: (string | undefined)[]) => {
    const add = names.map((n) => n?.trim()).filter((n): n is string => Boolean(n));
    if (!add.length) return;
    const list = [...add, ...prefs.recentNames().filter((n) => !add.includes(n))].slice(0, 10);
    write(NAMES_KEY, JSON.stringify(list));
  },
  forgetName: (name: string) => write(NAMES_KEY, JSON.stringify(prefs.recentNames().filter((n) => n !== name))),
  /** The seat token this device holds for a game. */
  seatToken: (id: string) => read(`rain-go:seat:${id}`),
  setSeatToken: (id: string, token: string) => write(`rain-go:seat:${id}`, token),
  /** A read-only link to one seat's view, e.g. the seat this person's AI plays. */
  watchToken: (id: string) => read(`rain-go:watch:${id}`),
  setWatchToken: (id: string, token: string) => write(`rain-go:watch:${id}`, token),
  /** The host token for a room this device created. */
  hostToken: (id: string) => read(`rain-go:host:${id}`),
  setHostToken: (id: string, token: string) => write(`rain-go:host:${id}`, token),
  avatar: () => read("rain-go:avatar") || "person",
  setAvatar: (v: string) => write("rain-go:avatar", v),
  lastNames: () => readJson<{ human: string; ai: string }>(LAST_NAMES_KEY, { human: "", ai: "" }),
  setLastNames: (human: string, ai: string) => write(LAST_NAMES_KEY, JSON.stringify({ human: human.trim(), ai: ai.trim() })),
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, seatToken?: string): Promise<T> {
  const headers = new Headers(init.headers);
  const token = prefs.token();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (seatToken) headers.set("x-seat", seatToken);
  if (init.body) headers.set("content-type", "application/json");
  const res = await fetch(path, { ...init, headers });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(body.error ?? res.status), String(body.message ?? body.error ?? res.statusText));
  return body as T;
}

export interface GameMeta {
  id: string;
  kind: GameKind;
  seats: PublicSeat[];
  labels: string[];
  over: boolean;
  /** Room still filling up. */
  waiting?: boolean;
  waitingOn: Seat[];
  moves: number;
  result?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SeatSpec {
  kind: SeatKind;
  name?: string;
  me?: boolean;
  avatar?: string;
}

export interface Invite {
  seat: Seat;
  kind: SeatKind;
  name: string;
  joined: boolean;
  link: string | null;
}

export const api = {
  config: () => request<{ authRequired: boolean }>("/api/config"),
  checkAuth: () => request<{ ok: true }>("/api/auth"),
  listGames: () => request<{ games: GameMeta[] }>("/api/games").then((r) => r.games),
  createGame: (o: { kind: GameKind; options: Record<string, string>; seats: SeatSpec[]; room?: boolean }) =>
    request<{ match: MatchView; token: string | null; hostToken: string | null; invites: Invite[] }>("/api/games", { method: "POST", body: JSON.stringify(o) }),
  getGame: (id: string, seatToken?: string, watchToken?: string) =>
    request<{ match: MatchView }>(`/api/games/${id}`, watchToken ? { headers: { "x-watch": watchToken } } : {}, seatToken).then((r) => r.match),
  invites: (id: string) => request<{ invites: Invite[]; tokens: (string | null)[] }>(`/api/games/${id}/invites`),
  act: (id: string, seatToken: string, action: MatchAction) =>
    request<{ match: MatchView }>(`/api/games/${id}/actions`, { method: "POST", body: JSON.stringify(action) }, seatToken).then((r) => r.match),
  /** Host only, while the room waits: who sits in a seat, the host included (`host: true`). */
  setSeat: (id: string, hostToken: string, o: { seat: Seat; kind: SeatKind; name?: string; avatar?: string; joined?: boolean; host?: boolean }) =>
    request<{ match: MatchView; invites: Invite[] }>(`/api/games/${id}/seats`, { method: "POST", body: JSON.stringify(o), headers: { "x-host": hostToken } }),
  /** Times the AI in an MCP seat on a practice position; the host or that seat's watcher may ask. */
  bench: (id: string, seat: Seat, auth: { host?: string; watch?: string }) =>
    request<{ ok: true }>(`/api/games/${id}/bench`, {
      method: "POST",
      body: JSON.stringify({ seat }),
      headers: { ...(auth.host ? { "x-host": auth.host } : {}), ...(auth.watch ? { "x-watch": auth.watch } : {}) },
    }),
  startRoom: (id: string, hostToken: string) => request<{ match: MatchView }>(`/api/games/${id}/start`, { method: "POST", headers: { "x-host": hostToken } }),
  /** Every seat's invite link, for the room's host. */
  roomInvites: (id: string, hostToken: string) => request<{ invites: Invite[]; tokens: (string | null)[] }>(`/api/games/${id}/invites`, { headers: { "x-host": hostToken } }),
  /** The plain-text table for a human seat, for a model that plays it from this browser. */
  describe: (id: string, seatToken: string) => request<{ text: string; moveHelp: string; version: number }>(`/api/games/${id}/describe`, { cache: "no-store" }, seatToken),
};
