import { GAMES, defaultSeatKinds, type GameKind, type Match, type NewSeat, type SeatKind } from "@rain-go/engine";
import { newSeatToken } from "./env";

export interface SeatSpec {
  kind: SeatKind;
  name?: string;
  /** Marks the seat taken by whoever creates the game. */
  me?: boolean;
  avatar?: string;
}

const KINDS = new Set<SeatKind>(["human", "ai", "bot"]);

/** Validates requested seats (or fills the game's default table) and mints a token per seat. */
export function buildSeats(kind: GameKind, gameId: string, raw: unknown): { seats: NewSeat[]; mine: number | null } | { error: string } {
  const mod = GAMES[kind];
  const specs: SeatSpec[] = Array.isArray(raw) && raw.length
    ? raw.map((r) => (typeof r === "string" ? { kind: r as SeatKind } : (r as SeatSpec)))
    : defaultSeatKinds(kind).map((k, i) => ({ kind: k, me: i === 0 }));
  if (specs.length < mod.players.min || specs.length > mod.players.max) {
    return { error: `${mod.name.zh}要 ${mod.players.min === mod.players.max ? mod.players.min : `${mod.players.min} 到 ${mod.players.max}`} 个座位` };
  }
  if (specs.some((s) => !KINDS.has(s.kind))) return { error: "座位类型只能是 human、ai 或 bot" };
  if (specs.some((s) => s.kind === "bot") && !mod.bot) return { error: `${mod.name.zh}还没有机器人` };
  // Bot-only tables would have nobody to drive them past the autoplay cap, and burn CPU for no one.
  if (!specs.some((s) => s.kind === "human" || s.kind === "ai")) return { error: "至少要有一个真人或 AI 座位" };
  const mineIdx = specs.findIndex((s) => s.me);
  if (specs.filter((s) => s.me).length > 1) return { error: "只能坐一个座位" };
  return {
    seats: specs.map((s, i) => ({
      kind: s.kind,
      name: typeof s.name === "string" ? s.name : undefined,
      avatar: typeof s.avatar === "string" ? s.avatar : undefined,
      token: newSeatToken(gameId),
      joined: i === mineIdx,
    })),
    mine: mineIdx < 0 ? null : mineIdx,
  };
}

export interface Invite {
  seat: number;
  kind: SeatKind;
  name: string;
  joined: boolean;
  /** Page link for a human seat, MCP connector URL for an AI seat. */
  link: string | null;
}

export function invitesOf(m: Match, origin: string): Invite[] {
  return m.seats.map((s, i) => ({
    seat: i,
    kind: s.kind,
    name: s.name,
    joined: s.joined,
    link: s.kind === "human" ? `${origin}/g/${m.id}?t=${s.token}` : s.kind === "ai" ? `${origin}/mcp/seat/${s.token}` : null,
  }));
}
