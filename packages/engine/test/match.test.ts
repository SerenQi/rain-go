import { describe, expect, it } from "vitest";
import {
  GAMES,
  applyMatchAction,
  createMatch,
  describeMatch,
  joinSeat,
  openSeat,
  reversiLegal,
  seatByToken,
  setSeatKind,
  startMatch,
  timeoutMatch,
  turnDeadline,
  practiceMatch,
  TURN_TIMEOUT_MS,
  shuffled,
  statusOf,
  viewMatch,
  type Match,
  type MatchAction,
  type NewSeat,
  type SeatKind,
} from "../src";

const seats = (...kinds: SeatKind[]): NewSeat[] =>
  kinds.map((kind, i) => ({ kind, token: `t${i}`, name: kind === "bot" ? undefined : ["Seren", "Claude", "Lunare", "Fy"][i], joined: kind !== "ai" }));
const newMatch = (kind: Match["kind"], ...kinds: SeatKind[]) =>
  createMatch({ id: "m1", kind, seats: seats(...(kinds.length ? kinds : (["human", "ai"] as SeatKind[]))), seed: 42, now: 0 });

function run(m: Match, steps: [seat: number, action: MatchAction | string][]): Match {
  for (const [seat, a] of steps) {
    const res = applyMatchAction(m, seat, typeof a === "string" ? { type: "move", move: a } : a, 1);
    if (!res.ok) throw new Error(`seat ${seat} ${JSON.stringify(a)}: ${res.message}`);
    m = res.match;
  }
  return m;
}

describe("rng", () => {
  it("shuffles deterministically", () => {
    const [a, s1] = shuffled([1, 2, 3, 4, 5, 6, 7, 8], 7);
    const [b] = shuffled([1, 2, 3, 4, 5, 6, 7, 8], 7);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(s1).not.toBe(7);
  });
});

describe("match layer", () => {
  it("every ready module declares consistent metadata", () => {
    for (const g of Object.values(GAMES)) {
      expect(g.name.zh.length).toBeGreaterThan(0);
      if (!g.ready) continue;
      expect(g.rules.length).toBeGreaterThan(20);
      expect(g.players.min).toBeGreaterThanOrEqual(2);
      expect(g.players.max).toBeGreaterThanOrEqual(g.players.min);
      expect(g.players.default).toBeGreaterThanOrEqual(g.players.min);
      expect(g.players.default).toBeLessThanOrEqual(g.players.max);
      for (const o of g.options) expect(o.choices.some((c) => c.value === o.default)).toBe(true);
    }
  });

  it("rejects placeholder games, wrong seat counts and bots without a bot player", () => {
    const stub = Object.values(GAMES).find((g) => !g.ready);
    if (stub) expect(() => newMatch(stub.kind)).toThrow();
    expect(() => newMatch("go", "human", "ai", "ai")).toThrow(/2-2 players/);
    const noBot = Object.values(GAMES).find((g) => g.ready && !g.bot);
    if (noBot) expect(() => createMatch({ id: "x", kind: noBot.kind, seats: seats("human", "bot"), seed: 1, now: 0 })).toThrow(/bot/);
  });

  it("plays Go through the generic layer", () => {
    let m = newMatch("go");
    m = run(m, [[0, "E5"], [1, "pass"], [0, "pass"]]);
    expect(statusOf(m).waitingOn.sort()).toEqual([0, 1]);
    m = run(m, [[0, "accept"], [1, "accept"]]);
    expect(statusOf(m).resultText).toBe("Seren 胜 · 黑 +73.5");
    expect(m.log.map((l) => l.move)).toEqual(["E5", "pass", "pass", "accept", "accept"]);
  });

  it("reports illegal moves with a Chinese message", () => {
    const res = applyMatchAction(newMatch("go"), 1, { type: "move", move: "E5" }, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toBe("还没轮到你");
    expect(applyMatchAction(newMatch("go"), 5, { type: "resign" }, 1).ok).toBe(false);
  });

  it("handles resign, say and rename of any seat", () => {
    let m = newMatch("gomoku");
    m = run(m, [[1, { type: "say", text: "hi" }], [0, { type: "rename", seat: 1, name: "Lunare" }], [1, { type: "resign" }]]);
    expect(m.seats[1]!.name).toBe("Lunare");
    expect(m.chat[0]).toMatchObject({ seat: 1, text: "hi" });
    expect(statusOf(m).outcome?.winners).toEqual([0]);
    expect(statusOf(m).resultText).toBe("Lunare 认输");
    expect(applyMatchAction(m, 0, { type: "move", move: "H8" }, 2).ok).toBe(false);
  });

  it("finds seats by token, tracks joining and open seats", () => {
    let m = newMatch("gomoku", "human", "ai");
    expect(seatByToken(m, "t1")).toBe(1);
    expect(seatByToken(m, "nope")).toBeNull();
    expect(openSeat(m, "ai")).toBe(1);
    m = joinSeat(m, 1, 5);
    expect(openSeat(m, "ai")).toBeNull();
  });

  it("describes the match for the AI in its own seat", () => {
    const m = run(newMatch("gomoku"), [[0, "H8"]]);
    const t = describeMatch(m, 1, "https://x/g/m1");
    expect(t).toContain("Game m1 · Gomoku (五子棋) · 2 players");
    expect(t).toContain("You are Claude in seat 1 (白)");
    expect(t).toContain("Status: YOUR TURN");
    expect(t).toContain("Last move: H8.");
    expect(describeMatch(m, 0)).toContain("You are X (black)");
  });

  it("gives both arena seats the same game information apart from their color", () => {
    const game = createMatch({ id: "equal", kind: "gomoku", informationMode: "equal", seats: seats("ai", "ai"), seed: 42, now: 0 });
    const m = run(game, [[0, "H8"], [1, { type: "say", text: "private chat must not change the state" }]]);
    const black = JSON.parse(describeMatch(m, 0, "https://example.test/g/equal"));
    const white = JSON.parse(describeMatch(m, 1));
    expect(black.you).toBe("black");
    expect(white.you).toBe("white");
    expect({ ...black, you: "same" }).toEqual({ ...white, you: "same" });
    expect(black).toMatchObject({ turn: "white", last_move: "H8", stones: { black: ["H8"], white: [] } });
    expect(JSON.stringify(black)).not.toMatch(/private chat|https:|Seren|Claude|t0|t1/);
  });

  it("builds per-viewer and spectator views without tokens", () => {
    const m = newMatch("reversi");
    const v = viewMatch<{ you: number | null }>(m, 1);
    expect(v.labels).toEqual(["黑", "白"]);
    expect(v.me).toBe(1);
    expect(v.view.you).toBe(2);
    expect(v.status.waitingOn).toEqual([0]);
    expect("state" in v).toBe(false);
    expect(JSON.stringify(v)).not.toContain("t0");
    expect(viewMatch<{ you: number | null }>(m, null).view.you).toBeNull();
  });
});

describe("bots", () => {
  it("a bot moves at once when it holds the first seat", () => {
    const m = newMatch("gomoku", "bot", "human");
    expect(m.log).toHaveLength(1);
    expect(m.log[0]).toMatchObject({ seat: 0, move: "H8" });
    expect(statusOf(m).waitingOn).toEqual([1]);
    expect(m.seats[0]!.name).toBe("小雨");
  });

  it("answers every human move", () => {
    let m = newMatch("reversi", "human", "bot");
    m = run(m, [[0, "d3"]]);
    expect(m.log.map((l) => l.seat)).toEqual([0, 1]);
    expect(statusOf(m).waitingOn).toEqual([0]);
  });

  for (const kind of ["go", "gomoku", "reversi"] as const) {
    it(`${kind}: two bots play a whole game to the end`, () => {
      const m = createMatch({ id: "b", kind, seats: seats("bot", "bot"), seed: 3, now: 0 });
      expect(statusOf(m).outcome).not.toBeNull();
      expect(m.log.length).toBeGreaterThan(5);
    });
  }

  it("gomoku bot wins when it can and otherwise blocks a four", () => {
    const g = GAMES.gomoku;
    const base = g.create({ seed: 1, players: 2, options: {} }) as { cells: number[]; size: number; toPlay: 1 | 2; moves: number };
    const at = (gtp: string) => {
      const col = "ABCDEFGHJKLMNOP".indexOf(gtp[0]!);
      return (15 - Number(gtp.slice(1))) * 15 + col;
    };
    const block = { ...base, cells: base.cells.slice(), toPlay: 2 as const, moves: 7 };
    for (const p of ["A1", "B1", "C1", "D1"]) block.cells[at(p)] = 1;
    for (const p of ["H8", "J9", "K10"]) block.cells[at(p)] = 2;
    expect(g.bot!(block, 1)).toBe("E1");
    const win = { ...block, cells: block.cells.slice() };
    win.cells[at("G7")] = 2;
    win.cells[at("L11")] = 0;
    win.cells[at("F6")] = 2;
    expect(g.bot!(win, 1)).toMatch(/^(E5|L11)$/);
  });
});

describe("gomoku", () => {
  it("five in a row wins", () => {
    const m = run(newMatch("gomoku"), [
      [0, "A1"], [1, "A2"], [0, "B1"], [1, "B2"], [0, "C1"], [1, "C2"], [0, "D1"], [1, "D2"], [0, "E1"],
    ]);
    expect(statusOf(m).resultText).toBe("Seren 胜 · 黑连五");
  });

  it("shows the board without recommending tactical moves", () => {
    const m = run(newMatch("gomoku"), [[0, "A1"], [1, "A2"], [0, "B1"], [1, "B2"], [0, "C1"], [1, "C2"], [0, "D1"]]);
    expect(describeMatch(m, 1)).toContain("X X X X .");
    expect(describeMatch(m, 1)).not.toMatch(/threatens five|Block it|win now/);
  });
});

describe("reversi", () => {
  it("starts with four legal moves and flips", () => {
    let m = newMatch("reversi");
    expect(Object.keys(reversiLegal((m.state as { cells: number[] }).cells, 1)).length).toBe(4);
    m = run(m, [[0, "d3"]]);
    const s = m.state as { flipped: number[]; toPlay: number };
    expect(s.flipped).toEqual([27]);
    expect(s.toPlay).toBe(2);
    expect(applyMatchAction(m, 1, { type: "move", move: "a1" }, 1).ok).toBe(false);
  });

  it("ends when neither side can move", () => {
    const m = run(newMatch("reversi"), [
      [0, "e6"], [1, "f4"], [0, "e3"], [1, "f6"], [0, "g5"], [1, "d6"], [0, "e7"], [1, "f5"], [0, "c5"],
    ]);
    expect(statusOf(m).outcome?.winners).toEqual([0]);
    expect(statusOf(m).waitingOn).toEqual([]);
  });
});

describe("waiting rooms", () => {
  const room = (...kinds: SeatKind[]) =>
    createMatch({
      id: "r1",
      kind: "doudizhu",
      seats: kinds.map((kind, i) => ({ kind, token: `t${i}`, joined: i === 0, avatar: i === 0 ? "drop" : undefined })),
      seed: 7,
      now: 0,
      hostToken: "h",
      host: 0,
    });

  it("holds every move and bot until the host starts a full table", () => {
    let m = room("human", "human", "bot");
    expect(m).toMatchObject({ waiting: true, host: 0, hostToken: "h" });
    expect(viewMatch(m, 0)).not.toHaveProperty("hostToken");
    expect(m.log).toHaveLength(0);
    expect(m.seats[0]!.avatar).toBe("drop");
    expect(statusOf(m).waitingOn).toEqual([]);
    expect(applyMatchAction(m, 0, { type: "move", move: "bid 3" }, 1)).toMatchObject({ ok: false, error: "not_started" });
    expect(startMatch(m, 1)).toMatchObject({ ok: false, error: "not_full" });
    m = joinSeat(m, 1, 1);
    const res = startMatch(m, 2);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.match.waiting).toBe(false);
    expect(statusOf(res.match).waitingOn.length).toBeGreaterThan(0);
    expect(startMatch(res.match, 3)).toMatchObject({ ok: false, error: "started" });
  });

  it("lets the host turn open seats into friends, AIs, bots or their own bot, with a fresh token", () => {
    const m = room("human", "human", "human");
    const bot = setSeatKind(m, 1, "bot", "new1", 1);
    expect(bot).toMatchObject({ ok: true });
    if (!bot.ok) return;
    expect(bot.match.seats[1]).toMatchObject({ kind: "bot", joined: true, token: "new1" });
    const ai = setSeatKind(bot.match, 1, "ai", "new2", 2, { name: "Claude", avatar: "spark" });
    expect(ai.ok && ai.match.seats[1]).toMatchObject({ kind: "ai", joined: false, name: "Claude", avatar: "spark", token: "new2" });
    const mine = setSeatKind(m, 2, "human", "new3", 3, { name: "小鲸", joined: true });
    expect(mine.ok && mine.match.seats[2]).toMatchObject({ kind: "human", joined: true, name: "小鲸" });
    expect(setSeatKind(joinSeat(m, 1, 1), 1, "bot", "x", 1)).toMatchObject({ ok: false, error: "taken" });
    // Filling seats back to front must not give two bots the same name.
    const back = setSeatKind(m, 2, "bot", "b2", 1);
    const front = back.ok ? setSeatKind(back.match, 1, "bot", "b1", 2) : back;
    expect(front.ok && new Set(front.match.seats.slice(1).map((s) => s.name)).size).toBe(2);
  });

  it("lets the host give their own seat to an AI and run the room from outside, or sit back down", () => {
    const m = room("human", "human", "human");
    const out = setSeatKind(m, 0, "ai", "new0", 1, { name: "Claude" });
    expect(out.ok && out.match.seats[0]).toMatchObject({ kind: "ai", joined: false, token: "new0" });
    if (!out.ok) return;
    expect(out.match.host).toBeUndefined();
    expect(out.match.hostToken).toBe("h");
    const back = setSeatKind(out.match, 2, "human", "new2", 2, { name: "房主", host: true });
    expect(back.ok && back.match).toMatchObject({ host: 2, seats: [{}, {}, { joined: true, name: "房主" }] });
    if (!back.ok) return;
    expect(setSeatKind(back.match, 1, "human", "x", 3, { host: true })).toMatchObject({ ok: false, error: "seated" });
    const nobody = createMatch({ id: "g", kind: "go", seats: [{ kind: "human", token: "a" }, { kind: "human", token: "b" }], seed: 1, now: 0, hostToken: "h" });
    expect(nobody.waiting).toBe(true);
    expect(nobody.host).toBeUndefined();
    const bots = [0, 1].reduce((acc, i) => {
      const r = setSeatKind(acc, i, "bot", `b${i}`, 1);
      return r.ok ? r.match : acc;
    }, nobody);
    expect(startMatch(bots, 2)).toMatchObject({ ok: false, error: "bots_only" });
  });

  it("labels the seat's read-only watch link in the AI's state", () => {
    const text = describeMatch(room("human", "ai", "bot"), 1, "https://x.test/g/r1?w=abc");
    expect(text).toContain("Watch link (read-only, shows only your own seat's cards, cannot play for you): https://x.test/g/r1?w=abc");
    expect(describeMatch(room("human", "ai", "bot"), 1)).not.toContain("Watch link");
  });

  it("keeps tables created without a host token playing at once", () => {
    expect(newMatch("gomoku").waiting).toBeUndefined();
  });
});

describe("turn clock", () => {
  it("lets the rule bot move for a seat that runs out of time, and restarts the clock", () => {
    const m = newMatch("gomoku", "human", "human");
    expect(turnDeadline(m)).toBe(TURN_TIMEOUT_MS);
    expect(timeoutMatch(m, TURN_TIMEOUT_MS - 1)).toBeNull();
    const late = timeoutMatch(m, TURN_TIMEOUT_MS);
    expect(late).not.toBeNull();
    expect(late!.log).toHaveLength(1);
    expect(late!.log[0]).toMatchObject({ seat: 0, timeout: true });
    expect(late!.turnAt).toBe(TURN_TIMEOUT_MS);
    expect(statusOf(late!).waitingOn).toEqual([1]);
    const moved = applyMatchAction(late!, 1, { type: "move", move: "A1" }, TURN_TIMEOUT_MS + 5);
    expect(moved.ok && moved.match.turnAt).toBe(TURN_TIMEOUT_MS + 5);
  });

  it("does not run while a room waits or after the game ends", () => {
    const room = createMatch({ id: "r", kind: "go", seats: [{ kind: "human", token: "a", joined: true }, { kind: "human", token: "b", joined: true }], seed: 1, now: 0, hostToken: "h" });
    expect(turnDeadline(room)).toBeNull();
    expect(timeoutMatch(room, 10 * TURN_TIMEOUT_MS)).toBeNull();
    const started = startMatch(room, 50);
    expect(started.ok && turnDeadline(started.match)).toBe(50 + TURN_TIMEOUT_MS);
    const over = applyMatchAction(newMatch("gomoku"), 0, { type: "resign" }, 1);
    expect(over.ok && turnDeadline(over.match)).toBeNull();
  });
});

describe("practice positions", () => {
  it("finds a late, unfinished position where the seat must act, for every game", () => {
    for (const g of Object.values(GAMES).filter((x) => x.ready)) {
      const n = g.players.default;
      const table = { id: "p", kind: g.kind, options: undefined, seats: seats(...Array<SeatKind>(n).fill("human")).map((s) => ({ ...s, joined: true, name: s.name ?? "x" })) };
      const seat = n - 1;
      const p = practiceMatch(table, seat, 11);
      expect(p, g.kind).not.toBeNull();
      expect(statusOf(p!).outcome, g.kind).toBeNull();
      expect(statusOf(p!).waitingOn, g.kind).toContain(seat);
      expect(p!.log.length, g.kind).toBeGreaterThan(5);
      expect(describeMatch(p!, seat)).toContain("YOUR TURN");
    }
  });
});
