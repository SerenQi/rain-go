import { GAMES, cleanOptions, readyGames, type GameKind, type GameModule } from "@rain-go/engine";
import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, prefs, type GameMeta, type SeatSpec } from "../api";
import { BRAND } from "../brand";
import { AVATAR_IDS, Avatar, AvatarCredit } from "../components/Avatar";
import { Sheet } from "../components/Chat";
import { Ring } from "../components/Pill";
import { Header, hhmm } from "../components/Shell";
import { notifyPrefs } from "../components/Settings";
import { useToast } from "../components/Toast";
import { navigate } from "../router";

const card = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35 } };

export const GLYPH: Record<GameKind, string> = {
  go: "围",
  gomoku: "五",
  reversi: "翻",
  chess: "♞",
  xiangqi: "帥",
  poker: "♠",
  paodekuai: "跑",
  monopoly: "⚄",
  aeroplane: "✈",
  doudizhu: "斗",
};

/** Symbol glyphs render smaller than CJK characters at the same size. */
const SYMBOL = new Set<GameKind>(["chess", "poker", "monopoly", "aeroplane"]);
const FAMILIES: { family: GameModule["family"]; title: string }[] = [
  { family: "棋", title: "棋" },
  { family: "牌", title: "牌" },
  { family: "骰", title: "骰" },
];

const playersText = (g: GameModule) => (g.players.min === g.players.max ? `${g.players.min} 人` : `${g.players.min}–${g.players.max} 人`);

export function statusOf(g: GameMeta) {
  if (g.over) return g.result ?? "已结束";
  if (g.waiting) return `等人入座 · ${g.seats.filter((s) => s.joined).length}/${g.seats.length}`;
  const waiting = g.waitingOn.map((i) => g.seats[i]?.name).filter(Boolean);
  return `等 ${waiting.join("、") || "…"}`;
}

export function Lobby() {
  const toast = useToast();
  const [needToken, setNeedToken] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");
  const [games, setGames] = useState<GameMeta[] | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [picked, setPicked] = useState<GameKind | null>(null);

  const load = useCallback(async () => {
    try {
      setGames(await api.listGames());
      setSyncedAt(Date.now());
      setNeedToken(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setNeedToken(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 15_000);
    const on = () => void load();
    window.addEventListener("prefschange", on);
    return () => {
      clearInterval(t);
      window.removeEventListener("prefschange", on);
    };
  }, [load]);

  const active = games?.filter((g) => !g.over) ?? [];
  const done = games?.filter((g) => g.over) ?? [];

  return (
    <>
      {toast.node}
      <Header status={`sync · ${syncedAt ? hhmm(syncedAt) : "--:--"}`} />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-4 lg:space-y-5 lg:overflow-visible xl:grid xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start xl:gap-5 xl:space-y-0">
        {needToken && (
          <motion.section {...card} className="glass px-5 py-4 lg:px-7 lg:py-6 xl:col-span-2">
            <div className="text-[1.2rem] font-semibold lg:text-[1.5rem]">访问口令</div>
            <p className="mt-0.5 text-sm text-muted lg:text-base">这个站点设了口令。填一次，这台设备会记住。</p>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                prefs.setToken(tokenDraft);
                notifyPrefs();
              }}
            >
              <input className="field !min-h-[44px]" type="password" value={tokenDraft} onChange={(e) => setTokenDraft(e.target.value)} placeholder="ACCESS_TOKEN" />
              <button className="btn btn-ink !min-h-[44px]">进入</button>
            </form>
          </motion.section>
        )}

        <motion.section {...card} className="glass px-4 py-4 lg:px-7 lg:py-7">
          <div className="flex items-baseline justify-between">
            <h1 className="text-[1.7rem] font-bold leading-none tracking-tight lg:text-[3rem]">玩什么</h1>
            <div className="truncate pl-3 text-sm text-muted lg:text-base">{BRAND.zh} · 选一个玩法开房间</div>
          </div>
          {FAMILIES.map(({ family, title }) => {
            const list = readyGames().filter((g) => g.family === family);
            if (!list.length) return null;
            return (
              <div key={family} className="mt-4 lg:mt-6">
                <div className="mb-2 text-sm text-muted">{title}</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(168px,1fr))] lg:gap-3">
                  {list.map((g) => (
                    <button
                      key={g.kind}
                      onClick={() => setPicked(g.kind)}
                      disabled={needToken}
                      className="flex flex-col items-start gap-1 rounded-2xl border border-white/80 bg-white/35 px-3 py-3 text-left transition hover:bg-white/60 disabled:opacity-50 lg:px-4 lg:py-4"
                    >
                      <span className="flex w-full items-center justify-between">
                        <span className={`leading-none ${SYMBOL.has(g.kind) ? "text-[1.7rem]" : "text-[1.4rem]"}`}>{GLYPH[g.kind]}</span>
                        <span className="text-xs text-muted">{playersText(g)}</span>
                      </span>
                      <span className="mt-1 font-semibold">{g.name.zh}</span>
                      <span className="line-clamp-2 text-xs text-muted">{g.blurb}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="mt-4 lg:mt-6">
            <div className="mb-2 text-sm text-muted">AI 对战</div>
            <button
              onClick={() => navigate("/arena")}
              className="flex w-full items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-left text-white transition hover:opacity-90"
            >
              <span className="text-[1.4rem] leading-none">擂</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">五子棋模型擂台</span>
                <span className="block truncate text-xs text-white/60">让两个模型对弈，网页实时观战</span>
              </span>
              <span className="text-white/60">›</span>
            </button>
          </div>
        </motion.section>

        {(games?.length ?? 0) > 0 ? (
          <motion.section {...card} className="glass px-5 py-3 lg:px-7 lg:py-6 xl:!sticky xl:top-6 xl:flex xl:max-h-[calc(100dvh-48px)] xl:flex-col xl:px-6">
            <div className="flex items-baseline justify-between">
              <div className="text-[1.25rem] font-bold lg:text-[1.9rem]">我的对局</div>
              <div className="text-sm text-muted">
                进行中 {active.length} · 下完 {done.length}
              </div>
            </div>
            <div className="divider my-2 lg:my-4" />
            <div className="space-y-1 lg:space-y-2 xl:-mr-2 xl:min-h-0 xl:overflow-y-auto xl:pr-2">
              {[...active, ...done.slice(0, 20)].map((g) => (
                <GameRow key={g.id} g={g} />
              ))}
            </div>
          </motion.section>
        ) : (
          // Desktop keeps the right column, so say what will show up there.
          <motion.section {...card} className="glass hidden px-6 py-6 xl:!sticky xl:top-6 xl:block">
            <div className="text-[1.9rem] font-bold">我的对局</div>
            <div className="divider my-4" />
            <p className="text-muted">还没有对局。在左边选一个玩法开房间，进行中和下完的对局都会列在这里。</p>
          </motion.section>
        )}
      </div>
      {picked && <CreateRoom kind={picked} onClose={() => setPicked(null)} toast={toast.show} />}
    </>
  );
}

/** Game options, table size and the host's name, then a room whose other seats start open. */
function CreateRoom({ kind, onClose, toast }: { kind: GameKind; onClose: () => void; toast: (m: string) => void }) {
  const mod = GAMES[kind];
  const [options, setOptions] = useState<Record<string, string>>(() => cleanOptions(kind));
  const [count, setCount] = useState(mod.players.default);
  const [name, setName] = useState(() => prefs.lastNames().human);
  const [avatar, setAvatar] = useState(prefs.avatar);
  const [seated, setSeated] = useState(true);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const seats: SeatSpec[] = Array.from({ length: count }, (_, i) =>
        i === 0 && seated ? { kind: "human", me: true, name: name.trim() || undefined, avatar } : { kind: "human" },
      );
      const res = await api.createGame({ kind, options, seats, room: true });
      if (res.token) prefs.setSeatToken(res.match.id, res.token);
      if (res.hostToken) prefs.setHostToken(res.match.id, res.hostToken);
      prefs.rememberNames(name);
      prefs.setLastNames(name, prefs.lastNames().ai);
      prefs.setAvatar(avatar);
      navigate(`/g/${res.match.id}`);
    } catch (e) {
      toast(e instanceof ApiError && e.status === 401 ? "需要访问口令" : e instanceof ApiError ? e.message : "开房间失败");
      setBusy(false);
    }
  };

  return (
    <Sheet title={`${GLYPH[kind]} ${mod.name.zh}`} onClose={onClose}>
      <p className="mt-1 text-sm text-muted">{mod.blurb}</p>
      <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto">
        {mod.options.map((o) => (
          <div key={o.key}>
            <div className="mb-1.5 text-sm text-muted">{o.label}</div>
            <div className="seg flex-wrap" role="group" aria-label={o.label}>
              {o.choices.map((c) => (
                <button key={c.value} className="whitespace-nowrap !px-3" aria-pressed={options[o.key] === c.value} onClick={() => setOptions({ ...options, [o.key]: c.value })}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        {mod.players.min !== mod.players.max && (
          <div>
            <div className="mb-1.5 text-sm text-muted">人数</div>
            <div className="seg" role="group" aria-label="人数">
              {Array.from({ length: mod.players.max - mod.players.min + 1 }, (_, i) => mod.players.min + i).map((n) => (
                <button key={n} className="!px-3.5" aria-pressed={count === n} onClick={() => setCount(n)}>
                  {n} 人
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <div className="mb-1.5 text-sm text-muted">你自己</div>
          <div className="seg" role="group" aria-label="你自己">
            <button aria-pressed={seated} onClick={() => setSeated(true)}>
              我也上桌
            </button>
            <button aria-pressed={!seated} onClick={() => setSeated(false)}>
              只当房主
            </button>
          </div>
        </div>
        <div className={seated ? "" : "hidden"}>
          <div className="mb-1.5 text-sm text-muted">你的名字和头像</div>
          <div className="flex items-center gap-2">
            <Avatar id={avatar} kind="human" size={44} />
            <input className="field !min-h-[44px]" value={name} onChange={(e) => setName(e.target.value)} placeholder="你的名字" maxLength={40} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {AVATAR_IDS.map((id) => (
              <button key={id} onClick={() => setAvatar(id)} aria-pressed={avatar === id} className={`rounded-full p-0.5 ${avatar === id ? "ring-2 ring-ink" : ""}`}>
                <Avatar id={id} size={30} />
              </button>
            ))}
          </div>
          <AvatarCredit />
        </div>
        <p className="text-sm text-muted">
          {seated
            ? `创建后进入房间。其余 ${count - 1} 个座位可以邀请好友、放入你的 Bot 或加机器人，坐满后由你开始。`
            : `你不上桌，${count} 个座位都空出来给好友或 AI，坐满后由你开始，你在旁边观战。之后也可以再坐下。`}
        </p>
      </div>
      <button className="btn btn-ink mt-4 w-full shrink-0 !min-h-[46px]" disabled={busy} onClick={create}>
        {busy ? "创建中…" : "创建房间"}
      </button>
    </Sheet>
  );
}

function GameRow({ g }: { g: GameMeta }) {
  const token = prefs.seatToken(g.id);
  const mine = !g.over && Boolean(token) && (g.waiting || g.waitingOn.some((i) => g.seats[i]?.kind === "human"));
  const mod = GAMES[g.kind];
  return (
    <button onClick={() => navigate(`/g/${g.id}`)} className="flex w-full items-center justify-between gap-3 rounded-2xl px-1 py-1.5 text-left transition hover:bg-white/30">
      <div className="stat-bar min-w-0">
        <div className="truncate text-[1.05rem] lg:text-[1.2rem]">
          {mod?.name.zh ?? g.kind} · {g.seats.map((s) => s.name).join(" × ")}
        </div>
        <div className="text-sm text-faint">
          {new Date(g.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {hhmm(g.updatedAt)}
        </div>
        <div className={`truncate text-[0.95rem] ${mine ? "font-semibold text-ink" : "text-muted"}`}>{statusOf(g)}</div>
      </div>
      <Ring value={GLYPH[g.kind] ?? "·"} fraction={g.over ? 1 : Math.min(1, g.moves / 100)} size={52} />
    </button>
  );
}
