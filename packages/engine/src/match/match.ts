import { GAMES } from "../games";
import { toGtp } from "../coords";
import type { GomokuState } from "../games/gomoku";
import { MAX_CHAT_LENGTH, cleanName } from "../record";
import type { GameKind, Outcome, Seat, SeatKind } from "./types";

export interface SeatInfo {
  kind: SeatKind;
  name: string;
  /** Secret that lets a person or AI act in this seat. Never sent to other players. */
  token: string;
  /** True once someone has taken the seat (always true for bots). */
  joined: boolean;
  /** Preset avatar id chosen by the web page; the page falls back to a default when absent. */
  avatar?: string;
}

export type PublicSeat = Omit<SeatInfo, "token">;

export interface LogEntry {
  seat: Seat;
  move: string;
  t: number;
}

export interface MatchChat {
  seat: Seat;
  text: string;
  t: number;
  /** Log length when the message was sent. */
  at: number;
}

export interface Match {
  id: string;
  kind: GameKind;
  informationMode?: "equal";
  createdAt: number;
  updatedAt: number;
  /** Bumped on every change, used for waiting and sync. */
  version: number;
  seats: SeatInfo[];
  state: unknown;
  resigned?: Seat;
  /** True while a room is filling up: nobody moves until the host starts it. */
  waiting?: boolean;
  /** Secret held by whoever created the room; it lets them arrange seats and start, seated or not. Never sent to players. */
  hostToken?: string;
  /** The seat the host sits in, if they play. */
  host?: Seat;
  log: LogEntry[];
  chat: MatchChat[];
}

export type MatchAction =
  | { type: "move"; move: string }
  | { type: "resign" }
  | { type: "say"; text: string }
  /** Renames `seat` (default: the acting seat). Anyone at the table may rename anyone. */
  | { type: "rename"; seat?: Seat; name: string; avatar?: string };

export type MatchResult = { ok: true; match: Match } | { ok: false; error: string; message: string };

export interface NewSeat {
  kind: SeatKind;
  name?: string;
  token: string;
  joined?: boolean;
  avatar?: string;
}

export interface NewMatchOptions {
  id: string;
  kind: GameKind;
  informationMode?: "equal";
  options?: Record<string, unknown>;
  /** Seats in turn order; seat 0 acts first. */
  seats: NewSeat[];
  seed: number;
  now: number;
  /** Opens the table as a waiting room run by whoever holds this token. */
  hostToken?: string;
  /** The seat the host takes, if they play. */
  host?: Seat;
}

const BOT_NAMES = ["小雨", "晚风", "青灯", "檐铃", "竹影"];

export function moduleOf(kind: GameKind) {
  return GAMES[kind];
}

/** Keeps only known options with allowed values, filling defaults. */
export function cleanOptions(kind: GameKind, raw: Record<string, unknown> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of GAMES[kind].options) {
    const v = raw[o.key] === undefined ? undefined : String(raw[o.key]);
    out[o.key] = v !== undefined && o.choices.some((c) => c.value === v) ? v : o.default;
  }
  return out;
}

/** Seat kinds a game accepts; bots only when the module can play them. */
export const seatKindsFor = (kind: GameKind): SeatKind[] => (GAMES[kind].bot ? ["human", "ai", "bot"] : ["human", "ai"]);

/** Default table for a game: the human, one AI, then bots (or more humans) up to the default count. */
export function defaultSeatKinds(kind: GameKind): SeatKind[] {
  const mod = GAMES[kind];
  const out: SeatKind[] = ["human", "ai"];
  while (out.length < mod.players.default) out.push(mod.bot ? "bot" : "human");
  return out.slice(0, Math.max(mod.players.min, out.length));
}

export function defaultName(kind: SeatKind, seats: { kind: SeatKind }[], index: number): string {
  const nth = seats.slice(0, index + 1).filter((s) => s.kind === kind).length;
  if (kind === "bot") return BOT_NAMES[(nth - 1) % BOT_NAMES.length]!;
  if (kind === "ai") return nth > 1 ? `AI ${nth}` : "AI";
  return nth > 1 ? `朋友 ${nth - 1}` : "Human";
}

export function createMatch(o: NewMatchOptions): Match {
  const mod = GAMES[o.kind];
  if (!mod?.ready) throw new Error(`Game "${o.kind}" is not available.`);
  const n = o.seats.length;
  if (n < mod.players.min || n > mod.players.max) {
    throw new Error(`${mod.name.en} takes ${mod.players.min}-${mod.players.max} players, got ${n}.`);
  }
  if (o.seats.some((s) => s.kind === "bot") && !mod.bot) throw new Error(`${mod.name.en} has no bot players.`);
  const seats: SeatInfo[] = o.seats.map((s, i) => ({
    kind: s.kind,
    name: cleanName(s.name) ?? defaultName(s.kind, o.seats, i),
    token: s.token,
    joined: s.kind === "bot" || Boolean(s.joined),
    ...(cleanAvatar(s.avatar) ? { avatar: cleanAvatar(s.avatar) } : {}),
  }));
  const state = mod.create({ seed: o.seed >>> 0, players: n, options: cleanOptions(o.kind, o.options) });
  const room = o.hostToken ? { waiting: true, hostToken: o.hostToken, ...(o.host !== undefined && seats[o.host] ? { host: o.host } : {}) } : {};
  const m: Match = { id: o.id, kind: o.kind, ...(o.kind === "gomoku" && o.informationMode === "equal" ? { informationMode: "equal" as const } : {}), createdAt: o.now, updatedAt: o.now, version: 1, seats, state, ...room, log: [], chat: [] };
  return m.waiting ? m : autoplay(m, o.now);
}

export interface MatchStatus {
  waitingOn: Seat[];
  outcome: Outcome | null;
  /** Chinese result line with names, e.g. "Seren 胜 · 黑 +3.5". */
  resultText: string | null;
}

export function statusOf(m: Match): MatchStatus {
  const mod = GAMES[m.kind];
  const names = m.seats.map((s) => s.name);
  if (m.resigned !== undefined) {
    const winners = m.seats.map((_, i) => i).filter((i) => i !== m.resigned);
    return { waitingOn: [], outcome: { winners, text: "认输" }, resultText: `${names[m.resigned]} 认输` };
  }
  if (m.waiting) return { waitingOn: [], outcome: null, resultText: null };
  const outcome = mod.outcome(m.state);
  if (!outcome) return { waitingOn: mod.waitingOn(m.state), outcome: null, resultText: null };
  const who = outcome.winners.length ? `${outcome.winners.map((s) => names[s]).join("、")} 胜` : "和局";
  return { waitingOn: [], outcome, resultText: `${who} · ${outcome.text}` };
}

/** Lets bot seats take their turns until a person or AI must act. */
export function autoplay(m: Match, now: number): Match {
  const mod = GAMES[m.kind];
  if (!mod.bot || m.waiting) return m;
  let cur = m;
  for (let guard = 0; guard < 1000; guard++) {
    const st = statusOf(cur);
    if (st.outcome) break;
    const seat = st.waitingOn.find((s) => cur.seats[s]?.kind === "bot");
    if (seat === undefined) break;
    const move = mod.bot(cur.state, seat);
    const res = mod.apply(cur.state, seat, move);
    if (!res.ok) break;
    cur = { ...cur, state: res.state, log: [...cur.log, { seat, move: res.log ?? move, t: now }].slice(-500) };
  }
  return cur;
}

const fail = (error: string, message: string): MatchResult => ({ ok: false, error, message });

export function applyMatchAction(m: Match, seat: Seat, action: MatchAction, now: number): MatchResult {
  if (!Number.isInteger(seat) || seat < 0 || seat >= m.seats.length) return fail("bad_seat", "没有这个座位");
  const bump = (patch: Partial<Match>): Match => ({ ...m, ...patch, updatedAt: now, version: m.version + 1 });
  const status = statusOf(m);
  switch (action.type) {
    case "move": {
      if (m.waiting) return fail("not_started", "人还没齐，房主开始后才能走");
      if (status.outcome) return fail("game_over", "对局已经结束");
      const move = String(action.move ?? "").trim();
      if (!move) return fail("empty_move", "没有写这步棋");
      const res = GAMES[m.kind].apply(m.state, seat, move);
      if (!res.ok) return fail("illegal", res.error);
      const log = [...m.log, { seat, move: res.log ?? move, t: now }].slice(-500);
      return { ok: true, match: autoplay(bump({ state: res.state, log }), now) };
    }
    case "resign": {
      if (m.waiting) return fail("not_started", "还没开局");
      if (status.outcome) return fail("game_over", "对局已经结束");
      return { ok: true, match: bump({ resigned: seat, log: [...m.log, { seat, move: "resign", t: now }].slice(-500) }) };
    }
    case "say": {
      const text = String(action.text ?? "").trim().slice(0, MAX_CHAT_LENGTH);
      if (!text) return fail("empty", "消息是空的");
      return { ok: true, match: bump({ chat: [...m.chat, { seat, text, t: now, at: m.log.length }].slice(-100) }) };
    }
    case "rename": {
      const target = action.seat ?? seat;
      if (!m.seats[target]) return fail("bad_seat", "没有这个座位");
      const name = cleanName(action.name);
      if (!name) return fail("bad_name", "名字要 1 到 40 个字");
      const avatar = cleanAvatar(action.avatar);
      return { ok: true, match: bump({ seats: m.seats.map((s, i) => (i === target ? { ...s, name, ...(avatar ? { avatar } : {}) } : s)) }) };
    }
  }
}

/** Host only (the caller checks the host token): starts a waiting room once every seat is taken. */
export function startMatch(m: Match, now: number): MatchResult {
  if (!m.waiting) return fail("started", "已经开局了");
  const open = m.seats.filter((s) => !s.joined).length;
  if (open) return fail("not_full", `还差 ${open} 人`);
  // Same rule as creating a table: bots alone would play out the whole game for nobody.
  if (m.seats.every((s) => s.kind === "bot")) return fail("bots_only", "至少要有一个真人或 AI");
  return { ok: true, match: autoplay({ ...m, waiting: false, updatedAt: now, version: m.version + 1 }, now) };
}

/**
 * Host only (the caller checks the host token), while waiting: turns an open seat, a bot, or the
 * host's own seat into an open human seat (a friend's invite), an open AI seat (an MCP connector)
 * or a bot. The seat gets a fresh token so old invite links stop working.
 */
export function setSeatKind(
  m: Match,
  seat: Seat,
  kind: SeatKind,
  token: string,
  now: number,
  /**
   * `joined` seats a human seat at once: the host's browser plays it, as a bot of theirs that calls
   * a model API, or as the host themself when `host` is set.
   */
  profile: { name?: unknown; avatar?: unknown; joined?: boolean; host?: boolean } = {},
): MatchResult {
  if (!m.waiting) return fail("started", "已经开局了");
  const cur = m.seats[seat];
  if (!cur) return fail("bad_seat", "没有这个座位");
  if (cur.joined && cur.kind !== "bot" && seat !== m.host) return fail("taken", "这个座位已经有人了");
  const sitting = profile.host === true && kind === "human";
  if (sitting && m.host !== undefined && m.host !== seat) return fail("seated", "你已经有座位了");
  if (kind === "bot" && !GAMES[m.kind].bot) return fail("no_bot", `${GAMES[m.kind].name.zh}还没有机器人`);
  const kinds = m.seats.map((s, i) => (i === seat ? { kind } : s));
  const avatar = cleanAvatar(profile.avatar);
  const next: SeatInfo = {
    kind,
    name: cleanName(profile.name) ?? defaultName(kind, kinds, seat),
    token,
    joined: kind === "bot" || (kind === "human" && (profile.joined === true || sitting)),
    ...(avatar ? { avatar } : {}),
  };
  const seats = m.seats.map((s, i) => (i === seat ? next : s));
  // The host either takes this seat or, by giving their own seat away, now only runs the room.
  const { host: _old, ...rest } = m;
  const host = sitting ? seat : m.host === seat ? undefined : m.host;
  return { ok: true, match: { ...rest, ...(host !== undefined ? { host } : {}), seats, updatedAt: now, version: m.version + 1 } };
}

/** Avatar ids are short preset names, e.g. "drop" or "whale". */
export const cleanAvatar = (raw: unknown): string | undefined =>
  typeof raw === "string" && /^[a-z0-9-]{1,24}$/.test(raw) ? raw : undefined;

export const seatByToken = (m: Match, token: string | null | undefined): Seat | null => {
  if (!token) return null;
  const i = m.seats.findIndex((s) => s.token === token);
  return i < 0 ? null : i;
};

/** Marks a seat as taken. */
export const joinSeat = (m: Match, seat: Seat, now: number): Match =>
  m.seats[seat]?.joined ? m : { ...m, seats: m.seats.map((s, i) => (i === seat ? { ...s, joined: true } : s)), updatedAt: now, version: m.version + 1 };

/** First seat of `kind` that nobody has taken yet. */
export const openSeat = (m: Match, kind: SeatKind): Seat | null => {
  const i = m.seats.findIndex((s) => s.kind === kind && !s.joined);
  return i < 0 ? null : i;
};

/** What one seat's client (or a spectator, `null`) receives: redacted state, status, no tokens. */
export interface MatchView<V = unknown> extends Omit<Match, "state" | "seats" | "hostToken"> {
  seats: PublicSeat[];
  me: Seat | null;
  view: V;
  status: MatchStatus;
  labels: string[];
}

export function viewMatch<V = unknown>(m: Match, viewer: Seat | null): MatchView<V> {
  const { state, seats, hostToken: _h, ...rest } = m;
  const mod = GAMES[m.kind];
  return {
    ...rest,
    seats: seats.map(({ token: _t, ...s }) => s),
    me: viewer,
    view: mod.view(state, viewer) as V,
    status: statusOf(m),
    labels: mod.seatLabels(state),
  };
}

const KIND_EN: Record<SeatKind, string> = { human: "human", ai: "AI", bot: "bot" };

/** Full text description for the AI in `seat`. `watchUrl` is a read-only page of this seat for the AI's person. */
export function describeMatch(m: Match, seat: Seat, watchUrl?: string): string {
  const mod = GAMES[m.kind];
  const labels = mod.seatLabels(m.state);
  const st = statusOf(m);
  if (m.kind === "gomoku" && m.informationMode === "equal") {
    const state = m.state as GomokuState;
    const stones: { black: string[]; white: string[] } = { black: [], white: [] };
    state.cells.forEach((color, i) => {
      if (color === 1) stones.black.push(toGtp(i, state.size));
      if (color === 2) stones.white.push(toGtp(i, state.size));
    });
    return JSON.stringify({
      game: "gomoku",
      rules: "Freestyle gomoku: 15x15. Black moves first. Place one stone on an empty intersection. Five or more consecutive stones horizontally, vertically, or diagonally wins; a full board is a draw. Columns A through P omit I; rows 1 through 15 count from bottom.",
      you: seat === 0 ? "black" : "white",
      turn: st.outcome ? null : state.toPlay === 1 ? "black" : "white",
      board_size: state.size,
      stones,
      last_move: state.last === undefined ? null : toGtp(state.last, state.size),
      outcome: st.outcome,
    });
  }
  const names = m.seats.map((s) => s.name);
  const out = [`Game ${m.id} · ${mod.name.en} (${mod.name.zh}) · ${m.seats.length} players`];
  if (watchUrl) {
    out.push(
      `Watch link (read-only, shows only your own seat's cards, cannot play for you): ${watchUrl} - give it to the person you play for if they have not got it yet. Never share hidden information from it with other players.`,
    );
  }
  out.push(`You are ${names[seat]} in seat ${seat} (${labels[seat] ?? ""}).`);
  out.push(
    `Seats: ${m.seats.map((s, i) => `${i} ${s.name} (${KIND_EN[s.kind]}${labels[i] ? `, ${labels[i]}` : ""}${s.joined ? "" : ", not joined yet"})`).join(" · ")}`,
  );
  if (m.waiting) out.push("Status: the room is still filling up; the host starts the game once every seat is taken. Call wait_for_opponent.");
  else if (st.resultText) out.push(`GAME OVER: ${st.resultText}.`);
  else if (st.waitingOn.includes(seat)) out.push(`Status: YOUR TURN. Call play. Move syntax: ${mod.moveHelp}`);
  else out.push(`Status: waiting for ${st.waitingOn.map((s) => names[s]).join(", ")}. Call wait_for_opponent.`);
  out.push("", mod.describe(m.state, seat, names));
  const recent = m.chat.slice(-6);
  if (recent.length) {
    out.push("", "Recent messages:");
    for (const c of recent) out.push(`- ${c.seat === seat ? `${names[c.seat]} (you)` : names[c.seat]}: ${c.text}`);
  }
  return out.join("\n");
}
