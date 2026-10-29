import { useEffect, useState } from "react";
import { api, ApiError, prefs, type Invite } from "../api";
import { AutopilotButton, useAutopilot } from "../components/Autopilot";
import { Sheet } from "../components/Chat";
import { InviteSheet } from "../components/InviteSheet";
import { MatchScreen } from "../components/MatchScreen";
import { WaitingRoom } from "../components/Room";
import { Header, hhmm } from "../components/Shell";
import { useToast } from "../components/Toast";
import { navigate } from "../router";
import { useMatch } from "../useMatch";

/** Reads `?t=<seat token>` and `?invite` once, remembers the token, and cleans the address bar. */
function takeUrlParams(id: string) {
  const q = new URLSearchParams(location.search);
  const t = q.get("t");
  if (t) prefs.setSeatToken(id, t);
  if (q.size) history.replaceState(null, "", `/g/${id}`);
  return { invite: q.has("invite") };
}

export function MatchPage({ id }: { id: string }) {
  const [params] = useState(() => takeUrlParams(id));
  const [token, setToken] = useState(() => prefs.seatToken(id));
  const { match, setMatch, error, live, syncedAt } = useMatch(id, token);
  const [owner, setOwner] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(params.invite);
  const [choices, setChoices] = useState<{ invites: Invite[]; tokens: (string | null)[] } | null>(null);
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
    </>
  );
  const pilotLines = Object.entries(pilot).filter(([seat]) => Number(seat) !== match.me);
  const extra = (match.me !== null || pilotLines.length > 0) && (
    <div className="flex flex-wrap items-center gap-1.5">
      <AutopilotButton match={match} token={token} state={match.me === null ? undefined : pilot[match.me]} />
      {pilotLines.map(([seat, s]) => (
        <span key={seat} className={`chip !text-xs ${s.error ? "!text-red-700" : ""}`}>
          {s.text}
        </span>
      ))}
    </div>
  );

  if (match.waiting) {
    return (
      <>
        {toast.node}
        <WaitingRoom
          match={match}
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
