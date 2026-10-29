import { GAMES, cleanOptions } from "@rain-go/engine";
import { useEffect, useState } from "react";
import { api, ApiError, prefs, type GameMeta } from "../api";
import { BRAND } from "../brand";
import { GLYPH, statusOf } from "../pages/Lobby";
import { navigate } from "../router";
import { Sheet } from "./Chat";

/**
 * Turns what a friend sent into a game address: an invite link, a room link, a seat code
 * (`<game id>-<hex>`), a watch code (`<game id>-w<hex>`) or a bare game id.
 */
export function joinPath(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  try {
    const u = new URL(text);
    const m = /^\/g\/([a-z0-9]+)\/?$/.exec(u.pathname);
    return m ? `/g/${m[1]}${u.search}` : null;
  } catch {
    // Not a link; try the codes below.
  }
  const code = /^([a-z0-9]+)-(w?)([0-9a-f]{16,})$/.exec(text);
  if (code) return `/g/${code[1]}?${code[2] ? "w" : "t"}=${encodeURIComponent(text)}`;
  return /^[a-z0-9]{4,}$/.test(text) ? `/g/${text}` : null;
}

/** Games still running that this device has a seat, host key or watch link for. */
const mine = (g: GameMeta) => !g.over && Boolean(prefs.seatToken(g.id) || prefs.hostToken(g.id) || prefs.watchToken(g.id));

/** Asked on every fresh page load: start a new game, or get back into one. */
export function Welcome({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<"ask" | "join">("ask");
  const [games, setGames] = useState<GameMeta[] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listGames().then(
      (all) => setGames(all.filter(mine)),
      () => setGames([]),
    );
  }, []);

  const go = (path: string) => {
    onClose();
    navigate(path);
  };
  /** No setup at all: a gomoku game against the rule bot, starting at once. */
  const quickStart = async () => {
    setBusy(true);
    try {
      const name = prefs.lastNames().human.trim() || undefined;
      const res = await api.createGame({
        kind: "gomoku",
        options: cleanOptions("gomoku"),
        seats: [{ kind: "human", me: true, name, avatar: prefs.avatar() }, { kind: "bot" }],
      });
      if (res.token) prefs.setSeatToken(res.match.id, res.token);
      go(`/g/${res.match.id}`);
    } catch (e) {
      setBusy(false);
      setError(e instanceof ApiError && e.status === 401 ? "这个站点需要访问口令，先在右上角设置里填好" : "开局失败，稍后再试");
    }
  };

  const join = async () => {
    const path = joinPath(draft);
    if (!path) return setError("认不出这个链接或口令，检查一下是不是完整复制了");
    const u = new URL(path, location.origin);
    setBusy(true);
    try {
      await api.getGame(u.pathname.split("/")[2]!, u.searchParams.get("t") ?? undefined, u.searchParams.get("w") ?? undefined);
    } catch (e) {
      // Only a missing game is certain here; anything else is left for the game page to explain.
      if (e instanceof ApiError && e.status === 404) {
        setBusy(false);
        return setError("找不到这局，可能链接不完整或对局已经被删掉了");
      }
    }
    go(path);
  };

  return (
    <Sheet title={step === "ask" ? `欢迎来到${BRAND.zh}` : "加入已有的对局"} onClose={onClose}>
      {step === "ask" ? (
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          <button className="rounded-2xl bg-ink px-4 py-4 text-left text-white transition hover:opacity-90" onClick={() => go("/")}>
            <span className="block text-[1.15rem] font-semibold">玩一局</span>
            <span className="mt-0.5 block text-sm text-white/65">选个玩法开房间，邀请好友或放入 AI</span>
          </button>
          <button className="rounded-2xl border border-white/80 bg-white/45 px-4 py-4 text-left transition hover:bg-white/65" onClick={() => {
            setError("");
            setStep("join");
          }}>
            <span className="block text-[1.15rem] font-semibold">
              加入已有的对局
              {games && games.length > 0 && <span className="ml-2 text-sm font-normal text-muted">{games.length} 局进行中</span>}
            </span>
            <span className="mt-0.5 block text-sm text-muted">回到你的对局，或粘贴好友发来的链接</span>
          </button>
          {games?.length === 0 && (
            <button
              className="flex items-center gap-3 rounded-2xl border border-dashed border-black/15 px-4 py-3 text-left transition hover:bg-white/40 disabled:opacity-50 sm:col-span-2"
              disabled={busy}
              onClick={() => void quickStart()}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/70 text-[1.2rem]">五</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{busy ? "开局中…" : "第一次来？先和机器人下一局五子棋"}</span>
                <span className="block text-sm text-muted">不用设置，马上开始，边下边熟悉</span>
              </span>
              <span className="text-faint">›</span>
            </button>
          )}
          {error && <p className="text-sm text-red-700 sm:col-span-2">{error}</p>}
        </div>
      ) : (
        <div className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void join();
            }}
          >
            <div className="mb-1.5 text-sm text-muted">好友发来的邀请链接或座位口令</div>
            <div className="flex gap-2">
              <input
                className="field !min-h-[44px]"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setError("");
                }}
                placeholder="粘贴链接或口令"
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
              <button className="btn btn-ink !min-h-[44px] shrink-0" disabled={!draft.trim() || busy}>
                {busy ? "查找中…" : "加入"}
              </button>
            </div>
            {error && <p className="mt-1.5 text-sm text-red-700">{error}</p>}
          </form>
          <div>
            <div className="mb-1.5 text-sm text-muted">我的对局</div>
            {games === null ? (
              <p className="text-sm text-muted">读取中…</p>
            ) : games.length ? (
              <div className="space-y-1.5">
                {games.map((g) => (
                  <button key={g.id} onClick={() => go(`/g/${g.id}`)} className="flex w-full items-center gap-3 rounded-2xl bg-white/35 px-3 py-2.5 text-left transition hover:bg-white/60">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink text-white">{GLYPH[g.kind]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {GAMES[g.kind]?.name.zh ?? g.kind} · {g.seats.map((s) => s.name).join(" × ")}
                      </span>
                      <span className="block truncate text-sm text-muted">{statusOf(g)}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">这台设备上没有进行中的对局。</p>
            )}
          </div>
          <button className="btn btn-glass w-full" onClick={() => setStep("ask")}>
            返回
          </button>
        </div>
      )}
    </Sheet>
  );
}
