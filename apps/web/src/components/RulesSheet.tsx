import { GAMES, TURN_TIMEOUT_MS, type GameKind } from "@rain-go/engine";
import { GUIDES } from "../games/guide";
import { Sheet } from "./Chat";

const seenKey = (kind: GameKind) => `rain-go:rules-seen:${kind}`;

/** True the first time this device opens a table of `kind`, and marks it seen. */
export function firstVisit(kind: GameKind): boolean {
  try {
    if (localStorage.getItem(seenKey(kind))) return false;
    localStorage.setItem(seenKey(kind), "1");
    return true;
  } catch {
    // Storage unavailable: never open uninvited, the rules button still works.
    return false;
  }
}

/** One game's rules for people: the goal, the points that trip newcomers up, and how to play here. */
export function RulesSheet({ kind, onClose }: { kind: GameKind; onClose: () => void }) {
  const mod = GAMES[kind];
  const g = GUIDES[kind];
  return (
    <Sheet title={`${mod.name.zh} · 规则`} onClose={onClose}>
      <div className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <p className="text-[1.02rem] leading-relaxed">{g.goal}</p>
        <ul className="space-y-2.5">
          {g.points.map((p) => (
            <li key={p} className="stat-bar text-[0.95rem] leading-relaxed text-ink-2">
              {p}
            </li>
          ))}
        </ul>
        <div className="rounded-2xl bg-white/45 px-4 py-3">
          <div className="text-sm font-semibold">怎么操作</div>
          <p className="mt-1 text-sm leading-relaxed text-muted">{g.how}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">每步限时 {TURN_TIMEOUT_MS / 1000} 秒，超时由规则机器人替你走一步。</p>
        </div>
      </div>
      <button className="btn btn-ink mt-4 w-full shrink-0" onClick={onClose}>
        知道了
      </button>
    </Sheet>
  );
}
