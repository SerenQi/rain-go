import { GAMES, TURN_TIMEOUT_MS, type MatchView } from "@rain-go/engine";
import { useEffect, useState } from "react";
import { api, ApiError, prefs, type Invite } from "../api";
import { AutopilotButton, useAutopilot } from "../components/Autopilot";
import { Sheet } from "../components/Chat";
import { InviteSheet } from "../components/InviteSheet";
import { MatchScreen } from "../components/MatchScreen";
import { RulesSheet } from "../components/RulesSheet";
import { WaitingRoom } from "../components/Room";
import { Header, hhmm, useNow } from "../components/Shell";
import { useToast } from "../components/Toast";
import { navigate } from "../router";
import { useMatch } from "../useMatch";
import { listBots, useDriven } from "../bots";

/** Reads `?t=<seat token>`, `?w=<watch token>` and `?invite` once, remembers the tokens, and cleans the address bar. */
function takeUrlParams(id: string) {
  const q = new URLSearchParams(location.search);
  const t = q.get("t");
  if (t) prefs.setSeatToken(id, t);
  const w = q.get("w");
  if (w) prefs.setWatchToken(id, w);
  if (q.size) history.replaceState(null, "", `/g/${id}`);
  // Opening someone else's seat or watch link: say where they landed. The host's own links don't count.
  const arrived = prefs.hostToken(id) ? null : t ? "seat" : w ? "watch" : null;
  return { invite: q.has("invite"), arrived };
}

export function MatchPage({ id }: { id: string }) {
  const [params] = useState(() => takeUrlParams(id));
  const [token, setToken] = useState(() => prefs.seatToken(id));
  const [watchToken] = useState(() => prefs.watchToken(id));
  const { match, setMatch, error, live, syncedAt } = useMatch(id, token, watchToken);
  /** Watching the seat a person's AI plays: its own cards, no moves. */
  const readOnly = !token && Boolean(watchToken) && match?.me != null;
  const [owner, setOwner] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(params.invite);
  const [choices, setChoices] = useState<{ invites: Invite[]; tokens: (string | null)[] } | null>(null);
  const [arrived, setArrived] = useState(params.arrived);
  const [rulesOpen, setRulesOpen] = useState(false);
  const toast = useToast();
  const pilot = useAutopilot(match);

  useEffect(() => prefs.setLastGame(id), [id]);
  useEffect(() => {
    api.config().then((c) => {
      if (!c.authRequired || prefs.token()) setOwner(true);
    }, () => {});
  }, []);
  // The site owner opening a game without a seat may take one of the human seats.
  useEffect(() => {
    if (!owner || token || !match || match.waiting) return;
    api.invites(id).then((r) => {
      if (r.tokens.some(Boolean)) setChoices(r);
    }, () => {});
  }, [owner, token, id, match?.id]);

  if (error || !match) {
    return (
      <>
        <Header status={error ? "offline" : "sync · …"} />
        <div className="glass grid h-64 place-items-center p-8 text-center">
          {error ? (
            <div>
              <div className="text-2xl">{error}</div>
              <button className="btn btn-ink mt-6" onClick={() => navigate("/")}>
                回大厅
              </button>
            </div>
          ) : (
            <span className="text-muted">Loading…</span>
          )}
        </div>
      </>
    );
  }

  const chip = (
    <>
      <span className={`inline-block h-2 w-2 rounded-full ${live ? "bg-ink" : "bg-faint"}`} />
      {live ? `live · ${hhmm(syncedAt ?? Date.now())}` : "offline"}
      <TurnClock match={match} />
    </>
  );
  const pilotLines = Object.entries(pilot).filter(([seat]) => Number(seat) !== match.me);
  const extra = !readOnly && (match.me !== null || pilotLines.length > 0) && (
    <div className="flex flex-wrap items-center gap-1.5">
      <AutopilotButton match={match} token={token} state={match.me === null ? undefined : pilot[match.me]} />
      {pilotLines.map(([seat, s]) => (
        <span key={seat} className={`chip !text-xs ${s.error ? "!text-red-700" : ""}`}>
          {s.text}
        </span>
      ))}
    </div>
  );

  const notices = (
    <>
      {arrived && match.me !== null ? (
        <ArrivalNotice match={match} watching={arrived === "watch"} onRules={() => setRulesOpen(true)} onClose={() => setArrived(null)} />
      ) : (
        !match.waiting && <TimeoutNotice match={match} readOnly={readOnly} />
      )}
      {rulesOpen && <RulesSheet kind={match.kind} onClose={() => setRulesOpen(false)} />}
    </>
  );

  if (match.waiting) {
    return (
      <>
        {toast.node}
        {notices}
        <WaitingRoom
          match={readOnly ? { ...match, me: null } : match}
          watch={readOnly && match.me !== null ? { seat: match.me, token: watchToken } : undefined}
          hostToken={prefs.hostToken(id)}
          onSeat={(t) => {
            prefs.setSeatToken(id, t);
            setToken(t);
          }}
          chip={chip}
          toast={toast.show}
          extra={extra}
        />
      </>
    );
  }

  return (
    <>
      {toast.node}
      <MatchScreen
        match={match}
        chip={chip}
        readOnly={readOnly}
        extra={extra || undefined}
        onInvite={owner ? () => setInviteOpen(true) : undefined}
        perform={async (action) => {
          if (!token) throw new Error("你在观战，没有座位");
          try {
            setMatch(await api.act(id, token, action));
            if (action.type === "rename") prefs.rememberNames(action.name);
          } catch (e) {
            if (e instanceof ApiError && (e.status === 401 || e.status === 403)) throw new Error("你没有这一局的座位");
            throw e;
          }
        }}
      />
      {notices}
      {inviteOpen && <InviteSheet id={id} mySeat={match.me} onClose={() => setInviteOpen(false)} toast={toast.show} />}
      {choices && !token && (
        <Sheet title="Seats" onClose={() => setChoices(null)}>
          <p className="mt-1 text-sm text-muted">这台设备还没有座位。选一个真人座位坐下，或者只是看看。</p>
          <div className="mt-3 space-y-2">
            {choices.invites.map((inv, i) =>
              choices.tokens[i] ? (
                <button
                  key={i}
                  className="btn btn-glass w-full justify-between"
                  onClick={() => {
                    const t = choices.tokens[i]!;
                    prefs.setSeatToken(id, t);
                    setToken(t);
                    setChoices(null);
                  }}
                >
                  <span>
                    座位 {inv.seat + 1} · {inv.name}
                  </span>
                  <span className="text-sm text-muted">{inv.joined ? "已有人" : "空位"}</span>
                </button>
              ) : null,
            )}
            <button className="btn btn-ink w-full" onClick={() => setChoices(null)}>
              只看看
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

/** Seconds left in the current turn; a rule bot moves for the seat when it runs out. */
function TurnClock({ match }: { match: MatchView }) {
  const now = useNow(1000).getTime();
  if (match.waiting || match.status.outcome) return null;
  const left = Math.max(0, Math.ceil(((match.turnAt ?? match.updatedAt) + TURN_TIMEOUT_MS - now) / 1000));
  return <span className={`ml-1 tabular-nums ${left <= 20 ? "font-semibold text-red-700" : ""}`} title={`每步限时 ${TURN_TIMEOUT_MS / 1000} 秒，超时由规则机器人代走`}>· {left}s</span>;
}

/**
 * After a seat this device answers for runs out of time: its own seat, a seat one of its API bots
 * plays, or the AI seat it watches. For an AI the fix is usually to think less, so say so.
 */
function TimeoutNotice({ match, readOnly }: { match: MatchView; readOnly: boolean }) {
  const driven = useDriven(match.id);
  const [seen, setSeen] = useState(() => {
    try {
      return Number(sessionStorage.getItem(`rain-go:timeout-seen:${match.id}`) ?? 0);
    } catch {
      return 0;
    }
  });
  const mine = (seat: number) => seat === match.me || seat in driven;
  // The log is capped, so the entry's time (not its index) says which timeouts were already dismissed.
  const entry = [...match.log].reverse().find((l) => l.timeout && l.t > seen && mine(l.seat));
  if (!entry || match.status.outcome) return null;
  const seat = entry.seat;
  const name = match.seats[seat]?.name ?? "";
  const botName = driven[seat] && listBots().find((b) => b.id === driven[seat]!.bot)?.name;
  const secs = TURN_TIMEOUT_MS / 1000;
  const text = driven[seat]
    ? `「${botName ?? name}」没在 ${secs} 秒内给出走法，规则机器人替它走了一步。建议在「连接」里把它的思考强度调低，或换一个更快的模型。`
    : readOnly || match.seats[seat]?.kind === "ai"
      ? `你的 AI「${name}」没在 ${secs} 秒内走棋，规则机器人替它走了一步。建议让 agent 降低思考强度（比如换低推理档位），或换一个更快的模型。`
      : `你没在 ${secs} 秒内走棋，规则机器人替你走了一步。`;
  const dismiss = () => {
    setSeen(entry.t);
    try {
      sessionStorage.setItem(`rain-go:timeout-seen:${match.id}`, String(entry.t));
    } catch {
      // Storage unavailable; the notice stays dismissed for this visit.
    }
  };
  return (
    <div role="alert" className="fixed inset-x-0 bottom-[calc(92px+env(safe-area-inset-bottom))] z-20 px-4 lg:inset-x-auto lg:right-8 lg:bottom-8 lg:w-[440px] lg:px-0">
      <div className="glass mx-auto flex max-w-[520px] items-start gap-3 !bg-white/80 px-4 py-3">
        <span className="mt-0.5 text-lg leading-none">⏱</span>
        <p className="min-w-0 flex-1 text-sm">{text}</p>
        <div className="flex shrink-0 flex-col gap-1.5">
          {driven[seat] && (
            <button className="btn btn-ink !min-h-[32px] !px-3 text-xs" onClick={() => navigate("/connect")}>
              去调整
            </button>
          )}
          <button className="btn btn-glass !min-h-[32px] !px-3 text-xs" onClick={dismiss}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}

/** For someone who just opened a friend's link: which seat is theirs and what they can do with it. */
function ArrivalNotice({ match, watching, onRules, onClose }: { match: MatchView; watching: boolean; onRules: () => void; onClose: () => void }) {
  const seat = match.me!;
  const game = GAMES[match.kind].name.zh;
  const where = ` ${seat + 1} 号位`;
  const text = watching
    ? `你在看「${match.seats[seat]?.name ?? ""}」在${game}里的视角，只能看到它自己的牌，不能替它操作。`
    : `你被邀请坐进${game}的${where}。${match.waiting ? "等房主开局，" : ""}可以自己下，也可以点「让 AI 帮我下」，用你自己的 API Bot 代下。`;
  return (
    <div role="status" className="fixed inset-x-0 bottom-[calc(92px+env(safe-area-inset-bottom))] z-20 px-4 lg:inset-x-auto lg:right-8 lg:bottom-8 lg:w-[440px] lg:px-0">
      <div className="glass mx-auto flex max-w-[520px] items-start gap-3 !bg-white/80 px-4 py-3">
        <span className="mt-0.5 text-lg leading-none">👋</span>
        <p className="min-w-0 flex-1 text-sm">{text}</p>
        <div className="flex shrink-0 flex-col gap-1.5">
          <button className="btn btn-ink !min-h-[32px] !px-3 text-xs" onClick={onRules}>
            看规则
          </button>
          <button className="btn btn-glass !min-h-[32px] !px-3 text-xs" onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
