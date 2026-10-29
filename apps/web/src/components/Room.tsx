import { GAMES, type MatchView, type Seat } from "@rain-go/engine";
import { useEffect, useState, type ReactNode } from "react";
import { mcpPrompt } from "../ai";
import { api, ApiError, prefs, type Invite } from "../api";
import { setDriven, useBots, useDriven, type MyBot } from "../bots";
import { navigate } from "../router";
import { GLYPH } from "../pages/Lobby";
import { Avatar } from "./Avatar";
import { Sheet } from "./Chat";
import { IconCopy } from "./icons";
import { Header } from "./Shell";

const tokenOfLink = (link: string | null | undefined) => {
  if (!link) return "";
  const u = new URL(link);
  return u.searchParams.get("t") ?? u.pathname.split("/").pop() ?? "";
};

export async function copyText(text: string, toast: (m: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制");
  } catch {
    toast("复制失败，请手动选择");
  }
}

/** What an agent needs: add the seat's connector, then follow the prompt. */
export const agentText = (link: string) => `先把这个地址添加为 MCP 连接器（只能玩这一个座位）：\n${link}\n\n然后：${mcpPrompt()}`;

/** The room before the game starts: who sits where, invites, and the host's start button. */
export function WaitingRoom({
  match,
  hostToken,
  onSeat,
  chip,
  toast,
  extra,
}: {
  match: MatchView;
  /** Set when this device created the room. */
  hostToken: string;
  /** The host took a seat (its token) or gave theirs away (""). */
  onSeat: (token: string) => void;
  chip: ReactNode;
  toast: (m: string) => void;
  /** The "let AI play for me" control. */
  extra?: ReactNode;
}) {
  const mod = GAMES[match.kind];
  const host = Boolean(hostToken);
  const driven = useDriven(match.id);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [editing, setEditing] = useState<Seat | null>(null);
  const [busy, setBusy] = useState(false);
  const open = match.seats.filter((s) => !s.joined).length;

  useEffect(() => {
    if (!host) return;
    api.roomInvites(match.id, hostToken).then((r) => setInvites(r.invites), () => {});
  }, [host, match.id, match.version, hostToken]);

  const start = async () => {
    setBusy(true);
    try {
      await api.startRoom(match.id, hostToken);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "开局失败");
    } finally {
      setBusy(false);
    }
  };

  const status = (i: number) => {
    const s = match.seats[i]!;
    if (i === match.host) return i === match.me ? "房主 · 你" : "房主";
    if (i === match.me) return "你";
    if (driven[i]) return "你的 Bot · 本页代下";
    if (s.kind === "bot") return "机器人";
    if (!s.joined) return s.kind === "ai" ? "等 AI 接入（MCP）" : "空位 · 等好友";
    return s.kind === "ai" ? "AI 已接入" : "已入座";
  };

  return (
    <>
      <Header status={chip} />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-4 lg:mx-auto lg:max-w-[560px] lg:overflow-visible">
        <section className="glass px-5 py-5 lg:px-7">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-ink text-[1.4rem] text-white">{GLYPH[match.kind]}</span>
            <div className="min-w-0">
              <h1 className="text-[1.5rem] font-bold leading-tight">{mod.name.zh} · 房间</h1>
              <p className="text-sm text-muted">{open ? `等人入座 · 还差 ${open} 人` : host ? "人齐了，可以开始" : "人齐了，等房主开始"}</p>
            </div>
          </div>
        </section>

        <section className="glass px-3 py-3 lg:px-5">
          {match.seats.map((s, i) => {
            const canEdit = host && (!s.joined || s.kind === "bot" || Boolean(driven[i]) || i === match.host);
            return (
              <div key={i} className="flex items-center gap-3 rounded-2xl px-2 py-2.5">
                <Avatar id={s.avatar} kind={s.kind} size={44} className={s.joined ? "" : "opacity-40"} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">
                    {s.joined || s.kind === "ai" ? s.name : "空位"}
                    <span className="ml-2 text-xs font-normal text-faint">{match.labels[i] || `座位 ${i + 1}`}</span>
                  </div>
                  <div className="truncate text-sm text-muted">{status(i)}</div>
                </div>
                {canEdit && (
                  <button className="btn btn-glass !min-h-[36px] shrink-0 !px-3 text-sm" onClick={() => setEditing(i)}>
                    {i === match.host ? "让出" : s.joined ? "更换" : "安排"}
                  </button>
                )}
              </div>
            );
          })}
        </section>

        {host ? (
          <button className="btn btn-ink w-full !min-h-[50px]" disabled={busy || open > 0} onClick={start}>
            {open ? `还差 ${open} 人才能开始` : "开始游戏"}
          </button>
        ) : (
          <div className="glass px-5 py-4 text-sm text-muted">
            {match.me === null ? "你在观战。房主开始后这里会显示牌桌。" : "已入座。等房主开始，你可以先在下面设置让 AI 帮你下。"}
          </div>
        )}
        {host && match.host === undefined && (
          <p className="px-1 text-sm text-muted">你没有上桌，开局后在旁边观战。想自己玩，点空座位上的「安排」→「我坐这里」。</p>
        )}
        {extra && <div className="glass px-4 py-3">{extra}</div>}
        <button className="btn btn-glass w-full" onClick={() => navigate("/")}>
          回大厅
        </button>
      </div>
      {editing !== null && invites && (
        <SeatSheet
          match={match}
          seat={editing}
          hostToken={hostToken}
          onSeat={onSeat}
          invite={invites[editing] ?? null}
          onInvites={setInvites}
          onClose={() => setEditing(null)}
          toast={toast}
        />
      )}
    </>
  );
}

type Mode = "menu" | "web" | "mcp";

/** Host's choices for one open seat. */
function SeatSheet({
  match,
  seat,
  hostToken,
  onSeat,
  invite,
  onInvites,
  onClose,
  toast,
}: {
  match: MatchView;
  seat: Seat;
  hostToken: string;
  onSeat: (token: string) => void;
  invite: Invite | null;
  onInvites: (i: Invite[]) => void;
  onClose: () => void;
  toast: (m: string) => void;
}) {
  const mod = GAMES[match.kind];
  const bots = useBots();
  const [mode, setMode] = useState<Mode>("menu");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mine = seat === match.host;
  const set = async (o: { kind: "human" | "ai" | "bot"; name?: string; avatar?: string; joined?: boolean; host?: boolean }) => {
    setBusy(true);
    try {
      const res = await api.setSeat(match.id, hostToken, { seat, ...o });
      onInvites(res.invites);
      setDriven(match.id, seat, null);
      // Giving away your own seat makes you a spectator who still runs the room.
      if (mine && !o.host) onSeat("");
      return res.invites[seat]!;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "没改成");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const sitHere = async () => {
    const inv = await set({ kind: "human", name: prefs.lastNames().human || undefined, avatar: prefs.avatar(), host: true });
    if (inv) {
      onSeat(tokenOfLink(inv.link));
      onClose();
    }
  };

  /** Friends get a fresh link; an existing open link of the right kind is reused. */
  const inviteBy = async (m: "web" | "mcp") => {
    const kind = m === "web" ? "human" : "ai";
    const cur = invite && invite.kind === kind && !invite.joined && !mine ? invite : await set({ kind });
    if (!cur) return;
    setLink(cur.link);
    setMode(m);
  };

  const seatBot = async (b: MyBot) => {
    if (b.type === "mcp") {
      const inv = await set({ kind: "ai", name: b.name, avatar: b.avatar });
      if (inv) {
        setLink(inv.link);
        setMode("mcp");
      }
      return;
    }
    const inv = await set({ kind: "human", name: b.name, avatar: b.avatar, joined: true });
    if (inv) {
      setDriven(match.id, seat, { bot: b.id, token: tokenOfLink(inv.link) });
      toast(`${b.name} 已入座，本页会替它下`);
      onClose();
    }
  };

  return (
    <Sheet title={mine ? "让出你的座位" : `座位 ${seat + 1}`} onClose={onClose}>
      <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto">
        {mode === "menu" && (
          <>
            {mine && <p className="text-sm text-muted">让出后你仍是房主，可以继续安排座位和开局，开局后在旁边观战。</p>}
            {match.host === undefined && (
              <button className="btn btn-ink w-full" disabled={busy} onClick={sitHere}>
                我坐这里
              </button>
            )}
            <div className="text-sm text-muted">邀请好友</div>
            <div className="grid grid-cols-2 gap-2">
              <button className="rounded-2xl border border-white/80 bg-white/40 px-3 py-3 text-left" disabled={busy} onClick={() => inviteBy("web")}>
                <span className="block font-semibold">网页链接</span>
                <span className="block text-xs text-muted">好友打开就能玩，也可以填 API 让 AI 代下</span>
              </button>
              <button className="rounded-2xl border border-white/80 bg-white/40 px-3 py-3 text-left" disabled={busy} onClick={() => inviteBy("mcp")}>
                <span className="block font-semibold">MCP 链接</span>
                <span className="block text-xs text-muted">发给好友的 agent，复制提示词就能接入</span>
              </button>
            </div>
            <div className="pt-1 text-sm text-muted">我的 Bot</div>
            {bots.length ? (
              <div className="space-y-1.5">
                {bots.map((b) => (
                  <button key={b.id} disabled={busy} onClick={() => seatBot(b)} className="flex w-full items-center gap-3 rounded-2xl bg-white/35 px-3 py-2 text-left">
                    <Avatar id={b.avatar} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{b.name || "未命名"}</span>
                      <span className="block truncate text-xs text-muted">{b.type === "api" ? `API · ${b.model}` : "MCP · 接入后复制提示词"}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <button className="w-full rounded-2xl bg-white/35 px-3 py-3 text-left text-sm text-muted" onClick={() => navigate("/connect")}>
                还没有 Bot。去「连接」里新建一个 ›
              </button>
            )}
            {mod.bot && (
              <button className="btn btn-glass w-full" disabled={busy} onClick={async () => (await set({ kind: "bot" })) && onClose()}>
                加一个机器人（规则 AI，不花钱）
              </button>
            )}
            {match.seats[seat]!.joined && (
              <button className="btn btn-glass w-full" disabled={busy} onClick={async () => (await set({ kind: "human" })) && onClose()}>
                {mine ? "先空着" : "清空这个座位"}
              </button>
            )}
          </>
        )}
        {mode === "web" && link && (
          <>
            <p className="text-sm text-muted">把链接发给好友。好友打开后就坐进这个座位，可以自己下，也可以填自己的 API Key 让 AI 代下。</p>
            <LinkBox text={link} toast={toast} />
            {typeof navigator.share === "function" && (
              <button className="btn btn-ink w-full" onClick={() => navigator.share({ title: "西窗", text: `来西窗一起玩${mod.name.zh}`, url: link }).catch(() => {})}>
                分享给好友
              </button>
            )}
          </>
        )}
        {mode === "mcp" && link && (
          <>
            <p className="text-sm text-muted">把下面这段整个复制给 agent（Claude、OpenCode 等支持远程 MCP 的客户端）。地址里带着座位口令，只发给要坐这个座位的人。</p>
            <LinkBox text={agentText(link)} toast={toast} multiline />
            <div className="text-xs text-faint">只要连接器地址：</div>
            <LinkBox text={link} toast={toast} />
          </>
        )}
        {mode !== "menu" && (
          <button className="btn btn-glass w-full" onClick={() => setMode("menu")}>
            换一种方式
          </button>
        )}
      </div>
    </Sheet>
  );
}

export function LinkBox({ text, toast, multiline = false }: { text: string; toast: (m: string) => void; multiline?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <code
        className={`field flex !min-h-[44px] items-center font-mono text-xs ${multiline ? "!h-auto whitespace-pre-wrap break-all py-2.5" : "overflow-x-auto whitespace-nowrap"}`}
      >
        {text}
      </code>
      <button className="btn btn-ink !min-h-[44px] shrink-0 !px-3.5" onClick={() => void copyText(text, toast)} aria-label="复制">
        <IconCopy width={18} height={18} />
      </button>
    </div>
  );
}
