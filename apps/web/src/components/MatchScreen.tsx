import { GAMES, type MatchAction, type MatchView, type Seat } from "@rain-go/engine";
import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { UIS } from "../games";
import type { BoardProps } from "../games/types";
import { ChatInput, ChatList, Sheet } from "./Chat";
import { DropMark, IconChat, IconFlag, IconGear, IconHome, IconInvite, IconName, IconRules } from "./icons";
import { RulesSheet, firstVisit } from "./RulesSheet";
import { Settings } from "./Settings";
import { NameSheet } from "./NameSheet";
import { Pill, Stat } from "./Pill";
import { Header, useLandscape, useWide } from "./Shell";
import { navigate } from "../router";
import { useToast } from "./Toast";

const card = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35 } };

/**
 * The shared game screen for any number of seats. `match.me` is the seat this screen plays
 * (null for a spectator). `perform` throws an Error whose message is shown as a toast.
 */
export function MatchScreen({
  match,
  perform,
  chip,
  extra,
  onInvite,
  readOnly = false,
}: {
  match: MatchView;
  perform: (a: MatchAction) => Promise<void>;
  chip: ReactNode;
  extra?: ReactNode;
  /** Shown as an invite button when the table still has open seats. */
  onInvite?: () => void;
  /** Watching through `me`'s eyes (its own cards) without being able to act for it. */
  readOnly?: boolean;
}) {
  const wide = useWide();
  const landscape = useLandscape();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [namesOpen, setNamesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  // A newcomer to this game gets its rules once, unasked.
  useEffect(() => {
    if (!readOnly && !match.status.outcome && firstVisit(match.kind)) setRulesOpen(true);
  }, [match.kind]);
  const [seenChat, setSeenChat] = useState(0);
  const mod = GAMES[match.kind];
  const ui = UIS[match.kind];
  const me = match.me;
  const names = match.seats.map((s) => s.name);
  const n = match.seats.length;
  /** Whether this screen may move, chat and resign for `me`. */
  const canPlay = me !== null && !readOnly;

  useEffect(() => {
    if (chatOpen) setSeenChat(match.chat.length);
  }, [chatOpen, match.chat.length]);

  // Card tables are roomier sideways: tell portrait phone users once per game.
  useEffect(() => {
    if (wide || landscape || !ui.prefersLandscape) return;
    const key = `rain-go:rotate-tip:${match.kind}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      return;
    }
    const t = setTimeout(() => toast.show("把手机横过来，牌桌更宽敞"), 900);
    return () => clearTimeout(t);
  }, [wide, landscape, ui.prefersLandscape, match.kind, toast.show]);

  const send = async (a: MatchAction) => {
    if (busy || !canPlay) return false;
    setBusy(true);
    try {
      await perform(a);
      return true;
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "出错了");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const st = match.status;
  const myTurn = canPlay && me !== null && !st.outcome && st.waitingOn.includes(me);
  const props: BoardProps = {
    match,
    view: match.view,
    me,
    canAct: myTurn && !busy,
    send: (move) => send({ type: "move", move }),
    toast: toast.show,
    compact: !wide,
  };
  const others = match.seats.map((_, i) => i).filter((i) => i !== me);
  const lastOther = [...match.chat].reverse().find((c) => c.seat !== me);
  const acting = st.waitingOn.find((s) => s !== me);
  const featured: Seat = acting ?? lastOther?.seat ?? others[0] ?? 0;
  const featuredSay = [...match.chat].reverse().find((c) => c.seat === featured);
  const waitingNames = st.waitingOn.filter((s) => s !== me).map((s) => names[s]);
  const status =
    st.resultText ??
    (readOnly && me !== null
      ? `只读 · ${names[me]} 的视角${waitingNames.length ? ` · 等 ${waitingNames.join("、")}` : ` · 轮到 ${names[me]}`}`
      : null) ??
    ui.status?.(match.view, match) ??
    (me === null
        ? `观战中 · 等 ${waitingNames.join("、")}`
        : myTurn ? "轮到你了" : `${waitingNames.join("、") || "对手"} 思考中…`);
  const badge = ui.badge?.(match.view, match) ?? { value: String(match.log.length), label: "MOVE" };
  const unread = match.chat.length > seenChat && match.chat.at(-1)?.seat !== me;
  const labelOf = (i: Seat) => match.labels[i] ?? "";
  const seatLine =
    n === 2
      ? [me ?? 0, 1 - (me ?? 0)].map((i) => `${names[i]} ${labelOf(i)}`).join(" · ")
      : `${n} 人桌 · ${me === null ? "观战" : `你 ${labelOf(me) || `${me + 1} 号位`}`}`;
  const thinking = !st.outcome && acting === featured;
  const subtitle = (
    <>
      {thinking && <span className="pulse-dot mr-1">●</span>}
      {featuredSay ? `“${featuredSay.text}”` : seatLine}
    </>
  );
  const openSeats = match.seats.some((s) => s.kind !== "bot" && !s.joined);
  const verdict = st.outcome
    ? me !== null && st.outcome.winners.includes(me)
      ? "WIN"
      : st.outcome.winners.length === 0
        ? "DRAW"
        : me === null
          ? "END"
          : "LOSE"
    : null;

  const resign = () => confirm("确定认输吗？") && void send({ type: "resign" });
  const Actions = ui.Actions;
  const board =
    ui.shape === "square" ? (
      <div className="board-fit min-h-0 flex-1">
        <div className="board-box glass grid place-items-center !rounded-[24px] p-1 lg:p-3">
          <ui.Board {...props} />
        </div>
      </div>
    ) : (
      <div className="glass flex min-h-0 flex-1 flex-col overflow-hidden !rounded-[24px] p-2 lg:p-4">
        <ui.Board {...props} />
      </div>
    );

  /** One chip per seat for tables of three or more. */
  const seatStrip =
    n > 2 ? (
      <div className="flex shrink-0 gap-1.5 overflow-x-auto">
        {match.seats.map((s, i) => {
          const waiting = !st.outcome && st.waitingOn.includes(i);
          return (
            <span key={i} className={`chip shrink-0 !px-2.5 !py-1 !text-[0.8rem] ${i === me ? "!border-black/30 !text-ink" : ""}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${waiting ? "bg-ink pulse-dot" : "bg-faint"}`} />
              {i === me ? "你" : s.name}
              {labelOf(i) && <span className="text-faint">{labelOf(i)}</span>}
            </span>
          );
        })}
      </div>
    ) : null;

  const sheets = (
    <>
      {rulesOpen && <RulesSheet kind={match.kind} onClose={() => setRulesOpen(false)} />}
      {chatOpen && (
        <Sheet title="Whisper" onClose={() => setChatOpen(false)}>
          <ChatList chat={match.chat} me={me} names={names} className="mt-3 min-h-0 flex-1" />
          {canPlay && me !== null && (
            <div className="mt-3 flex shrink-0">
              <ChatInput to={n === 2 ? names[1 - me]! : "大家"} busy={busy} compact onSend={(text) => send({ type: "say", text })} />
            </div>
          )}
        </Sheet>
      )}
      {namesOpen && (
        <NameSheet
          seats={match.seats.map((s, i) => ({ name: s.name, label: `${labelOf(i) || s.kind}${i === me ? " · 你" : ""}` }))}
          onClose={() => setNamesOpen(false)}
          onSave={async (next) => {
            for (let i = 0; i < next.length; i++) {
              if (next[i] !== names[i] && !(await send({ type: "rename", seat: i, name: next[i]! }))) return false;
            }
            return true;
          }}
        />
      )}
    </>
  );

  const pill = (
    <button onClick={() => setChatOpen(true)} className="pill-black flex shrink-0 items-center gap-3 !rounded-[26px] px-3.5 py-2.5 text-left land:gap-2.5 land:!rounded-[18px] land:px-2.5 land:py-2 land:shadow-none">
      <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-[#3a3a3a] bg-[#161616] land:h-9 land:w-9">
        <DropMark width={24} height={24} className="land:h-5 land:w-5" />
        {unread && <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-black bg-accent" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[1.25rem] italic leading-tight land:text-[1.05rem]">{names[featured]}</span>
        <span className="block truncate text-[0.9rem] text-white/70 land:text-[0.8rem]">{subtitle}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[1.4rem] font-bold leading-none land:text-[1.15rem]">{verdict ?? badge.value}</span>
        <span className="mt-1 block text-[0.72rem] text-white/55 land:text-[0.65rem]">{verdict ? mod.name.zh : badge.label}</span>
      </span>
    </button>
  );
  const iconButtons = (
    <>
      {!st.outcome && canPlay && (
        <button className="btn btn-glass shrink-0 !px-3.5" onClick={resign} aria-label="认输">
          <IconFlag width={20} height={20} />
        </button>
      )}
      {onInvite && openSeats && (
        <button className="btn btn-glass shrink-0 !px-3.5" onClick={onInvite} aria-label="邀请">
          <IconInvite width={20} height={20} />
        </button>
      )}
      <button className="btn btn-glass shrink-0 !px-3.5" onClick={() => setRulesOpen(true)} aria-label="规则">
        <IconRules width={20} height={20} />
      </button>
      <button className="btn btn-glass shrink-0 !px-3.5" onClick={() => setNamesOpen(true)} aria-label="名字">
        <IconName width={20} height={20} />
      </button>
      <button className="btn btn-glass relative shrink-0 !px-3.5" onClick={() => setChatOpen(true)} aria-label="聊天">
        <IconChat width={20} height={20} />
        {unread && <span className="absolute top-1.5 right-2 h-2 w-2 rounded-full bg-accent" />}
      </button>
    </>
  );

  if (!wide && landscape) {
    // Phone held sideways: the board on the left at full height, one glass panel on the right with
    // status and opponent at the top, recent moves in the middle, and the controls at the bottom
    // where the right thumb rests.
    const square = ui.shape === "square";
    const recent = match.log.slice(-6);
    const lastChat = match.chat.at(-1);
    const tool = "relative grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-2 transition active:scale-95 active:bg-white/60";
    return (
      <>
        {toast.node}
        <div className="flex min-h-0 flex-1 justify-center gap-3 py-[max(8px,env(safe-area-inset-top))]">
          <div className={square ? "flex aspect-square h-full min-h-0 max-w-[calc(100%-272px)] shrink-0 flex-col" : "flex min-h-0 min-w-0 flex-1 flex-col"}>
            {board}
          </div>
          <aside className={`glass flex min-h-0 shrink-0 flex-col gap-2 !rounded-[24px] p-2.5 ${square ? "w-auto min-w-[260px] max-w-[360px] flex-1" : "w-[min(290px,40vw)]"}`}>
            <div className="flex shrink-0 items-center gap-2 px-1.5 pt-0.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${myTurn ? "bg-ink" : "bg-faint"}`} />
              <span className="min-w-0 flex-1 truncate text-[0.95rem]">{status}</span>
              <span className="flex shrink-0 items-center gap-1 text-[0.72rem] text-faint">{chip}</span>
            </div>
            {pill}
            {seatStrip && <div className="shrink-0 [&>div]:flex-wrap [&>div]:overflow-visible">{seatStrip}</div>}
            <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden rounded-[16px] bg-white/25 px-3 py-2">
              {recent.length === 0 && !lastChat && (
                <div className="my-auto px-2 text-center">
                  <div className="text-[1.05rem] text-ink-2">{mod.name.zh}</div>
                  <div className="mt-1 text-[0.8rem] leading-snug text-faint">{mod.blurb}</div>
                </div>
              )}
              {/* Newest at the bottom; when space runs out the oldest lines are the ones cut off. */}
              <div className="flex min-h-0 flex-col-reverse gap-0.5 overflow-hidden [mask-image:linear-gradient(to_top,black_70%,transparent)]">
                {[...recent].reverse().map((l, i) => (
                  <div key={match.log.length - i} className={`flex shrink-0 gap-1.5 truncate text-[0.82rem] leading-snug ${i === 0 ? "text-ink" : "text-muted"}`}>
                    <span className="shrink-0 text-faint">{l.seat === me ? "你" : names[l.seat]}</span>
                    <span className="truncate">
                      {l.move}
                      {l.timeout && <span className="text-faint"> · 超时代走</span>}
                    </span>
                  </div>
                ))}
              </div>
              {lastChat && (
                <button onClick={() => setChatOpen(true)} className="mt-1.5 shrink-0 truncate border-t border-black/5 pt-1.5 text-left text-[0.82rem] italic text-ink-2">
                  {lastChat.seat === me ? "你" : names[lastChat.seat]}：{lastChat.text}
                </button>
              )}
            </div>
            {Actions && !st.outcome && canPlay && (
              <div className="flex shrink-0 gap-2 [&_.btn]:!min-h-[42px] [&_.btn]:flex-1">
                <Actions {...props} />
              </div>
            )}
            <div className="flex shrink-0 items-center justify-between px-0.5">
              <button className={tool} onClick={() => navigate("/")} aria-label="回大厅">
                <IconHome width={20} height={20} />
              </button>
              {!st.outcome && canPlay && (
                <button className={tool} onClick={resign} aria-label="认输">
                  <IconFlag width={20} height={20} />
                </button>
              )}
              {onInvite && openSeats && (
                <button className={tool} onClick={onInvite} aria-label="邀请">
                  <IconInvite width={20} height={20} />
                </button>
              )}
              <button className={tool} onClick={() => setRulesOpen(true)} aria-label="规则">
                <IconRules width={20} height={20} />
              </button>
              <button className={tool} onClick={() => setNamesOpen(true)} aria-label="名字">
                <IconName width={20} height={20} />
              </button>
              <button className={tool} onClick={() => setChatOpen(true)} aria-label="聊天">
                <IconChat width={20} height={20} />
                {unread && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-accent" />}
              </button>
              <button className={tool} onClick={() => setSettingsOpen(true)} aria-label="设置">
                <IconGear width={19} height={19} />
              </button>
            </div>
            {extra && <div className="shrink-0 [&_.btn]:!min-h-[32px] [&_.btn]:!text-xs">{extra}</div>}
          </aside>
        </div>
        {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
        {sheets}
      </>
    );
  }

  if (!wide) {
    return (
      <>
        {toast.node}
        <Header
          status={chip}
          left={
            <div className="flex min-w-0 items-center gap-2 text-[1.05rem]">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${myTurn ? "bg-ink" : "bg-faint"}`} />
              <span className="truncate">{status}</span>
            </div>
          }
        />
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {pill}
          {seatStrip}
          {board}
          <div className="flex shrink-0 gap-2 [&_.btn]:!min-h-[44px]">
            {Actions && !st.outcome && canPlay ? (
              <Actions {...props} />
            ) : (
              <div className="chip min-w-0 flex-1 justify-center !text-ink">
                <span className="truncate">
                  {match.log.length ? `${match.log.at(-1)!.seat === me ? "你" : names[match.log.at(-1)!.seat]} · ${match.log.at(-1)!.move}${match.log.at(-1)!.timeout ? "（超时代走）" : ""}` : mod.name.zh}
                </span>
              </div>
            )}
            {iconButtons}
          </div>
          {extra}
        </div>
        {sheets}
      </>
    );
  }

  const stats = ui.stats?.(match.view, match) ?? [];
  return (
    <>
      {toast.node}
      <Header status={chip} />
      <div className="game-grid">
        <motion.div {...card} className="area-pill flex flex-col gap-2">
          <Pill title={names[featured]} subtitle={subtitle} onClick={() => setChatOpen(true)} />
          {seatStrip}
        </motion.div>
        <motion.section {...card} className="glass area-hero px-7 py-6">
          <div className="text-[1.4rem] text-ink-2">
            {mod.name.en} · {mod.name.zh}
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-[3.6rem] font-bold leading-[1.02] tracking-tight">{st.outcome ? st.outcome.text : badge.value}</span>
            {!st.outcome && <span className="text-[1rem] tracking-wide text-muted">{badge.label}</span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[1.05rem] text-muted">
            <span>{seatLine}</span>
            <button className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.95rem] text-ink-2 hover:bg-white/50" onClick={() => setRulesOpen(true)}>
              <IconRules width={16} height={16} /> 规则
            </button>
            <button className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.95rem] text-ink-2 hover:bg-white/50" onClick={() => setNamesOpen(true)}>
              <IconName width={16} height={16} /> 改名
            </button>
            {onInvite && (
              <button className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.95rem] text-ink-2 hover:bg-white/50" onClick={onInvite}>
                <IconInvite width={16} height={16} /> 邀请
              </button>
            )}
          </div>
          <div className="mt-1 text-[1.05rem] text-ink">{status}</div>
        </motion.section>
        <motion.section {...card} className="area-board flex h-[min(78vh,760px)] flex-col">
          {board}
        </motion.section>
        {canPlay && !st.outcome && (
          <motion.section {...card} className="area-controls flex flex-wrap gap-3">
            {Actions && <Actions {...props} />}
            <button className="btn btn-glass flex-1" onClick={resign}>
              认输
            </button>
          </motion.section>
        )}
        {stats.length > 0 && (
          <motion.section {...card} className="glass area-stats px-7 py-6">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(76px,1fr))] gap-4">
              {stats.map((s) => (
                <Stat key={s.label} label={s.label} value={s.value} />
              ))}
            </div>
          </motion.section>
        )}
        <div className="area-chat flex flex-col gap-3">
          <motion.section {...card} className="glass px-6 py-5">
            <div className="text-[1.3rem] font-semibold">Whisper</div>
            <ChatList chat={match.chat} me={me} names={names} className="mt-3 max-h-56" />
            {canPlay && me !== null && (
              <div className="mt-3 flex">
                <ChatInput to={n === 2 ? names[1 - me]! : "大家"} busy={busy} onSend={(text) => send({ type: "say", text })} />
              </div>
            )}
          </motion.section>
          {extra}
        </div>
      </div>
      {sheets}
    </>
  );
}
