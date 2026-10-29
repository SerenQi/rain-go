import { COLUMNS, fromGtp, toGtp } from "../coords";
import type { GameModule, Seat } from "../match/types";

/**
 * Gomoku (freestyle): 15x15, seat 0 plays black and moves first, five or more in a row wins.
 * This module is the reference example for writing new games.
 */
export interface GomokuState {
  size: number;
  /** 0 empty, 1 black, 2 white. Index = y * size + x, y = 0 is the top row. */
  cells: number[];
  toPlay: 1 | 2;
  moves: number;
  last?: number;
  winLine?: number[];
  full?: boolean;
}

const DIRS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const;

/** Stones in the longest line through `p` for `color`, if it reaches five. */
function fiveThrough(cells: number[], size: number, p: number, color: number): number[] | null {
  const x0 = p % size;
  const y0 = Math.floor(p / size);
  for (const [dx, dy] of DIRS) {
    const line = [p];
    for (const sgn of [1, -1]) {
      let x = x0 + dx * sgn;
      let y = y0 + dy * sgn;
      while (x >= 0 && y >= 0 && x < size && y < size && cells[y * size + x] === color) {
        line.push(y * size + x);
        x += dx * sgn;
        y += dy * sgn;
      }
    }
    if (line.length >= 5) return line.sort((a, b) => a - b);
  }
  return null;
}

/** Seat 0 is black (1), seat 1 is white (2). */
const colorOf = (seat: Seat): 1 | 2 => (seat === 0 ? 1 : 2);
const seatOf = (c: 1 | 2): Seat => c - 1;

export interface GomokuView extends GomokuState {
  /** The viewer's colour, or null for spectators. */
  you: 1 | 2 | null;
}

export function gomokuBoardText(s: GomokuState): string {
  const cols = COLUMNS.slice(0, s.size).split("").join(" ");
  const rows = [`    ${cols}`];
  for (let y = 0; y < s.size; y++) {
    const n = String(s.size - y).padStart(2, " ");
    const cells = Array.from({ length: s.size }, (_, x) => {
      const c = s.cells[y * s.size + x];
      return c === 1 ? "X" : c === 2 ? "O" : ".";
    });
    rows.push(`${n}  ${cells.join(" ")}  ${n}`);
  }
  rows.push(`    ${cols}`);
  return rows.join("\n");
}

/** Longest run through `p` along one direction and how many of its two ends are open. */
function runAt(cells: number[], size: number, p: number, color: number, dx: number, dy: number): [number, number] {
  let len = 1;
  let open = 0;
  const x0 = p % size;
  const y0 = Math.floor(p / size);
  for (const sgn of [1, -1]) {
    let x = x0 + dx * sgn;
    let y = y0 + dy * sgn;
    while (x >= 0 && y >= 0 && x < size && y < size && cells[y * size + x] === color) {
      len++;
      x += dx * sgn;
      y += dy * sgn;
    }
    if (x >= 0 && y >= 0 && x < size && y < size && cells[y * size + x] === 0) open++;
  }
  return [len, open];
}

const RUN_SCORE = (len: number, open: number) =>
  len >= 5 ? 1e6 : open === 0 ? 0 : len === 4 ? (open === 2 ? 5e4 : 6e3) : len === 3 ? (open === 2 ? 4e3 : 400) : len === 2 ? (open === 2 ? 200 : 30) : open === 2 ? 10 : 2;

/** Heuristic bot: scores every point near the stones for its own shape plus how much it blocks. */
function gomokuBot(s: GomokuState, seat: Seat): string {
  const me = colorOf(seat);
  const them = me === 1 ? 2 : 1;
  const c = Math.floor(s.size / 2);
  if (s.moves === 0) return toGtp(c * s.size + c, s.size);
  let best = -1;
  let bestScore = -Infinity;
  for (let p = 0; p < s.cells.length; p++) {
    if (s.cells[p] !== 0) continue;
    const x = p % s.size;
    const y = Math.floor(p / s.size);
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++)
      for (let dx = -2; dx <= 2 && !near; dx++) {
        const qx = x + dx;
        const qy = y + dy;
        if (qx >= 0 && qy >= 0 && qx < s.size && qy < s.size && s.cells[qy * s.size + qx]) near = true;
      }
    if (!near) continue;
    const cells = s.cells.slice();
    let score = 0;
    for (const [dx, dy] of DIRS) {
      cells[p] = me;
      score += RUN_SCORE(...runAt(cells, s.size, p, me, dx, dy));
      cells[p] = them;
      score += 0.9 * RUN_SCORE(...runAt(cells, s.size, p, them, dx, dy));
    }
    score -= (Math.abs(x - c) + Math.abs(y - c)) * 0.01;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return toGtp(best, s.size);
}

export const gomoku: GameModule<GomokuState, GomokuView> = {
  kind: "gomoku",
  name: { zh: "五子棋", en: "Gomoku" },
  family: "棋",
  blurb: "横竖斜连成五子即胜。",
  ready: true,
  players: { min: 2, max: 2, default: 2 },
  options: [],
  rules: 'Freestyle gomoku on a 15x15 board. Seat 0 plays black and moves first. Five or more stones in a row (horizontal, vertical or diagonal) wins. Full board is a draw. Moves: a coordinate like "H8" (columns A-P skip I, row 1 is the bottom).',
  moveHelp: '"H8" (columns A-P skip I, row 1 at the bottom)',
  create() {
    const size = 15;
    return { size, cells: Array(size * size).fill(0), toPlay: 1, moves: 0 };
  },
  apply(s, seat, move) {
    if (s.winLine || s.full) return { ok: false, error: "对局已经结束" };
    if (colorOf(seat) !== s.toPlay) return { ok: false, error: "还没轮到你" };
    const p = fromGtp(move, s.size);
    if (p === null) return { ok: false, error: `看不懂这步：${move}` };
    if (s.cells[p] !== 0) return { ok: false, error: "这里已经有子了" };
    const cells = s.cells.slice();
    cells[p] = s.toPlay;
    const winLine = fiveThrough(cells, s.size, p, s.toPlay) ?? undefined;
    const full = !winLine && cells.every((c) => c !== 0);
    return {
      ok: true,
      state: { ...s, cells, last: p, moves: s.moves + 1, toPlay: s.toPlay === 1 ? 2 : 1, winLine, full: full || undefined },
      log: toGtp(p, s.size),
    };
  },
  waitingOn(s) {
    return s.winLine || s.full ? [] : [seatOf(s.toPlay)];
  },
  outcome(s) {
    if (s.winLine) {
      const winner = s.cells[s.winLine[0]!] as 1 | 2;
      return { winners: [seatOf(winner)], text: `${winner === 1 ? "黑" : "白"}连五` };
    }
    return s.full ? { winners: [], text: "棋盘下满" } : null;
  },
  seatLabels: () => ["黑", "白"],
  view(s, viewer) {
    return { ...s, you: viewer === null ? null : colorOf(viewer) };
  },
  describe(s, seat, names) {
    const ai = colorOf(seat);
    const sym = (c: number) => (c === 1 ? "X (black)" : "O (white)");
    const out = [`You are ${sym(ai)}. ${names[1 - seat]} is ${sym(ai === 1 ? 2 : 1)}. Moves so far: ${s.moves}.`];
    if (s.last !== undefined) out.push(`Last move: ${toGtp(s.last, s.size)}.`);
    out.push("", gomokuBoardText(s));
    return out.join("\n");
  },
  bot: gomokuBot,
};
