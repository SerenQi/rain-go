import { GAMES, TURN_TIMEOUT_MS, describeMatch, practiceMatch, type MatchView, type Seat } from "@rain-go/engine";
import { useState } from "react";
import { askMove, validateModel } from "../ai";
import { api, ApiError } from "../api";
import { listBots, modelOf, useDriven } from "../bots";
import { Avatar } from "./Avatar";

type Result = { ms: number | null; legal: boolean; note?: string };

const verdict = (r: Result) => {
  if (r.ms === null) return { text: "超过 120 秒没回答，正式对局会被机器人代走", tone: "text-red-700" };
  const secs = `${(r.ms / 1000).toFixed(1)} 秒`;
  const legal = r.legal ? "" : " · 走法不合法";
  if (r.ms >= TURN_TIMEOUT_MS * 0.8) return { text: `${secs}${legal} · 很可能超时，建议降低思考强度或换更快的模型`, tone: "text-red-700" };
  if (r.ms >= TURN_TIMEOUT_MS * 0.5) return { text: `${secs}${legal} · 偏慢，复杂局面可能超时`, tone: "text-amber-800" };
  return { text: `${secs}${legal} · 来得及`, tone: r.legal ? "text-ink" : "text-amber-800" };
};

/**
 * Optional, recommended before the host starts: time each AI this device answers for on a late
 * practice position of this very game, so slow models show up before the 120-second turn clock does.
 * API bots are timed right here; an MCP seat's agent gets the position through its own tools.
 */
export function BenchPanel({ match, hostToken, watch }: { match: MatchView; hostToken: string; watch?: { seat: Seat; token: string } }) {
  const driven = useDriven(match.id);
  const [local, setLocal] = useState<Record<number, Result>>({});
  const [running, setRunning] = useState<number | null>(null);
  const [error, setError] = useState("");

  const apiSeats = Object.keys(driven).map(Number);
  const mcpSeats = match.seats.map((s, i) => i).filter((i) => match.seats[i]!.kind === "ai" && (Boolean(hostToken) || watch?.seat === i));
  const seats = [...new Set([...apiSeats, ...mcpSeats])].sort((a, b) => a - b);
  if (!seats.length) return null;

  const runApi = async (seat: number) => {
    setError("");
    setRunning(seat);
    try {
      const bot = listBots().find((b) => b.id === driven[seat]!.bot);
      if (!bot) throw new Error("找不到这个 Bot");
      const model = modelOf(bot);
      if (!model.key) throw new Error(`${bot.name} 没有 API Key，去「连接」里补上`);
      validateModel(model);
      const table = { id: match.id, kind: match.kind, options: match.options, seats: match.seats.map((s) => ({ ...s, token: "" })) };
      const practice = practiceMatch(table, seat, crypto.getRandomValues(new Uint32Array(1))[0]!);
      if (!practice) throw new Error("这个游戏没法生成练习局面");
      const mod = GAMES[match.kind];
      const t0 = performance.now();
      const move = await askMove(model, describeMatch(practice, seat), mod.moveHelp, "");
      const ms = performance.now() - t0;
      const legal = Boolean(move) && mod.apply(practice.state, seat, move!).ok;
      setLocal((old) => ({ ...old, [seat]: { ms, legal } }));
    } catch (e) {
      setError(e instanceof TypeError ? "连接模型失败：服务可能不允许浏览器跨域访问" : e instanceof Error ? e.message : "测试失败");
    } finally {
      setRunning(null);
    }
  };

  const runMcp = async (seat: number) => {
    setError("");
    try {
      await api.bench(match.id, seat, watch?.seat === seat ? { watch: watch.token } : { host: hostToken });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "没发出去");
    }
  };

  return (
    <section className="glass px-4 py-4 lg:px-6">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-semibold">测一下 AI 的速度</div>
        <span className="shrink-0 text-xs text-muted">推荐 · 可跳过</span>
      </div>
      <p className="mt-1 text-sm text-muted">
        用一盘接近终局的练习局面（同样的游戏和人数）计时，看模型多久给出一步。正式对局每步限时 120 秒，超时由规则机器人代走。
      </p>
      <div className="mt-2 space-y-1.5">
        {seats.map((i) => {
          const s = match.seats[i]!;
          const isApi = i in driven;
          const pending = !isApi && match.benchPending?.seat === i;
          const result = isApi ? local[i] : match.bench?.[i];
          const v = result && verdict(result);
          return (
            <div key={i} className="flex items-center gap-3 rounded-2xl bg-white/30 px-3 py-2">
              <Avatar id={s.avatar} kind={s.kind} size={34} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {s.name}
                  <span className="ml-1.5 text-xs font-normal text-faint">{isApi ? "API" : "MCP"}</span>
                </div>
                <div className={`truncate text-xs ${v ? v.tone : "text-muted"}`}>
                  {running === i ? "思考中…" : pending ? "已发给 agent，等它回答…" : v ? v.text : !isApi && !s.joined ? "等 AI 接入后再测" : "还没测"}
                </div>
              </div>
              <button
                className="btn btn-glass !min-h-[34px] shrink-0 !px-3 text-sm"
                disabled={running !== null || pending || (!isApi && !s.joined)}
                onClick={() => void (isApi ? runApi(i) : runMcp(i))}
              >
                {result ? "再测" : "测速"}
              </button>
            </div>
          );
        })}
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}
