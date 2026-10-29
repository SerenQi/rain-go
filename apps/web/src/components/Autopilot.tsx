import type { MatchView } from "@rain-go/engine";
import { useEffect, useRef, useState } from "react";
import { askMove, validateModel } from "../ai";
import { api, ApiError } from "../api";
import { listBots, modelOf, setDriven, useBots, useDriven } from "../bots";
import { navigate } from "../router";
import { Avatar } from "./Avatar";
import { Sheet } from "./Chat";

type SeatState = { text: string; error?: boolean };

/**
 * Plays every seat this browser drives with one of its API bots: when the table waits on such a
 * seat, it reads the seat's text view, asks the model for a move and submits it with the seat's token.
 */
export function useAutopilot(match: MatchView | null): Record<number, SeatState> {
  const driven = useDriven(match?.id ?? "");
  const [states, setStates] = useState<Record<number, SeatState>>({});
  const busy = useRef(new Set<number>());
  const paused = useRef(new Set<number>());
  const controller = useRef(new AbortController());
  /** Bumped when a seat finishes, so a seat that must act twice in a row is picked up again. */
  const [tick, setTick] = useState(0);
  const say = (seat: number, s: SeatState) => setStates((old) => ({ ...old, [seat]: s }));

  // A seat that is driven again, e.g. after fixing its key, gets another chance.
  useEffect(() => {
    paused.current.clear();
  }, [driven]);

  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, [match?.id]);

  useEffect(() => {
    if (!match || match.waiting || match.status.outcome) return;
    const signal = controller.current.signal;
    for (const seat of match.status.waitingOn) {
      const d = driven[seat];
      if (!d || busy.current.has(seat) || paused.current.has(seat)) continue;
      const bot = listBots().find((b) => b.id === d.bot);
      busy.current.add(seat);
      void (async () => {
        try {
          if (!bot) throw new Error("找不到这个 Bot，可能已经删掉了");
          const model = modelOf(bot);
          if (!model.key) throw new Error(`${bot.name} 没有 API Key，去「连接」里补上`);
          validateModel(model);
          say(seat, { text: `${bot.name} 思考中…` });
          let correction = "";
          for (let attempt = 0; attempt < 3; attempt++) {
            const table = await api.describe(match.id, d.token);
            const move = await askMove(model, table.text, table.moveHelp, correction, signal);
            if (!move) {
              correction = 'Reply with only {"move": "..."}.';
              continue;
            }
            try {
              await api.act(match.id, d.token, { type: "move", move });
              say(seat, { text: `${bot.name} 走了 ${move}` });
              return;
            } catch (e) {
              if (!(e instanceof ApiError) || e.status !== 409) throw e;
              // The turn clock may have run out meanwhile and a rule bot moved for this seat.
              const now = await api.getGame(match.id, d.token);
              if (!now.status.waitingOn.includes(seat)) {
                say(seat, { text: `${bot.name} 超时，机器人代走了一步` });
                return;
              }
              correction = `"${move}" was rejected: ${e.message}`;
            }
          }
          throw new Error(`${bot.name} 连续三次没给出合法走法，已暂停`);
        } catch (e) {
          if (signal.aborted) return;
          paused.current.add(seat);
          say(seat, {
            text: e instanceof TypeError ? "连接模型失败：服务可能不允许浏览器跨域访问" : e instanceof Error ? e.message : "代下出错",
            error: true,
          });
        } finally {
          busy.current.delete(seat);
          if (!signal.aborted) setTick((t) => t + 1);
        }
      })();
    }
    // Re-run on every new version of the table.
  }, [match?.version, match?.id, driven, tick]);

  return states;
}

/** Lets the person at this seat hand it to one of their API bots, or take it back. */
export function AutopilotButton({ match, token, state }: { match: MatchView; token: string; state?: SeatState }) {
  const driven = useDriven(match.id);
  const bots = useBots().filter((b) => b.type === "api");
  const [open, setOpen] = useState(false);
  if (match.me === null || !token || match.status.outcome) return null;
  const me = match.me;
  const mine = driven[me];
  const bot = mine && bots.find((b) => b.id === mine.bot);
  return (
    <>
      <button
        className={`chip !text-sm ${mine ? "!bg-ink !text-white" : ""} ${state?.error ? "!text-red-700" : ""}`}
        onClick={() => setOpen(true)}
        title={state?.text}
      >
        {mine ? `AI 代下 · ${state?.error ? "已暂停" : bot?.name ?? "Bot"}` : "让 AI 帮我下"}
      </button>
      {open && (
        <Sheet title="让 AI 帮我下" onClose={() => setOpen(false)}>
          <p className="mt-1 text-sm text-muted">选一个你的 API Bot，本页会在轮到你时替你走。密钥只发给模型服务商；关掉页面就停。</p>
          {state?.error && <p className="mt-2 text-sm text-red-700">{state.text}</p>}
          <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
            {bots.map((b) => (
              <button
                key={b.id}
                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left ${mine?.bot === b.id ? "bg-ink text-white" : "bg-white/35"}`}
                onClick={() => {
                  setDriven(match.id, me, { bot: b.id, token });
                  setOpen(false);
                }}
              >
                <Avatar id={b.avatar} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{b.name || "未命名"}</span>
                  <span className="block truncate text-xs opacity-70">{b.model}</span>
                </span>
              </button>
            ))}
            {!bots.length && <p className="text-sm text-muted">还没有 API Bot。</p>}
            <button className="btn btn-glass w-full" onClick={() => navigate("/connect")}>
              去「连接」新建或修改 Bot
            </button>
            {mine && (
              <button
                className="btn btn-ink w-full"
                onClick={() => {
                  setDriven(match.id, me, null);
                  setOpen(false);
                }}
              >
                我自己来
              </button>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
