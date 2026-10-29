import { useEffect, useRef, useState } from "react";
import { PROVIDERS as providers, endpointFor, type Provider } from "../ai";
import { prefs, type Invite } from "../api";
import { Header } from "../components/Shell";
import { gomokuUI } from "../games/gomoku";
import type { GomokuView, MatchView } from "@rain-go/engine";

type Player = { kind: "api" | "mcp" | "opencode" | "manual" | "friend"; name: string; model: string; key: string; provider: Provider; customUrl: string; effort: "default" | "none" | "low" | "medium" | "high" | "xhigh" | "max" };
type Game = { id: string; invites: (Invite | null)[] };
type Step = "home" | "host-self" | "host-opponent" | "join-code" | "join-setup" | "live";
const initial = (i: number): Player => ({ kind: i ? "friend" : "manual", name: i ? "朋友" : "我", model: "MiniMax-M3.1-Flash", key: "", provider: "minimax-cn", customUrl: "", effort: "low" });
const prompt = (name = "西窗") => `请使用已连接的 ${name} MCP 座位下五子棋。先调用 get_state 查看状态；轮到你时，用 play 提交一个合法坐标；否则调用 wait_for_opponent 等待，超时后继续等待，直到对局结束。请自行判断局面。`;
const openCodeConfig = (link: string, i: number) => JSON.stringify({ mcp: { [`west-window-${i === 0 ? "black" : "white"}`]: { type: "remote", url: link, enabled: true, oauth: false, timeout: 70000 } } }, null, 2);
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const tokenOf = (invite: Invite | null | undefined) => invite?.link ? new URL(invite.link).pathname.split("/").pop() ?? "" : "";
function parseInvite(input: string): { id: string; token: string } {
  let token = input.trim();
  if (token.includes("://")) {
    let url: URL;
    try { url = new URL(token); } catch { throw new Error("链接格式不正确，请检查后重试。"); }
    if (url.origin !== location.origin || !/^\/arena\/?$/.test(url.pathname)) throw new Error("请使用本站的邀请链接。");
    token = new URLSearchParams(url.hash.slice(1)).get("seat") ?? "";
  }
  const match = /^([a-z0-9]{6,32})-[0-9a-f]{32}$/.exec(token);
  if (!match) throw new Error("口令格式不正确，请检查后重试。");
  return { id: match[1]!, token };
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.message === "string" ? data.message : `请求失败（${response.status}）`);
  return data as T;
}

export function Arena() {
  const [players, setPlayers] = useState<Player[]>(() => [initial(0), initial(1)]);
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(location.hash.slice(1)).get("seat") ?? "");
  const [step, setStep] = useState<Step>(() => new URLSearchParams(location.hash.slice(1)).has("seat") ? "join-code" : "home");
  const [joining, setJoining] = useState<{ id: string; token: string; seat: number } | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [liveMatch, setLiveMatch] = useState<MatchView<GomokuView> | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("准备开局");
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const update = (index: number, value: Partial<Player>) => setPlayers((old) => old.map((p, i) => i === index ? { ...p, ...value } : p));

  useEffect(() => {
    if (new URLSearchParams(location.hash.slice(1)).has("seat")) history.replaceState(null, "", location.pathname + location.search);
  }, []);

  function changeKind(index: number, kind: Player["kind"]) {
    const p = players[index]!;
    const defaultName = ["我", "朋友", "MiniMax", "MCP 选手", "OpenCode"].includes(p.name);
    const name = kind === "manual" ? "我" : kind === "friend" ? "朋友" : kind === "opencode" ? "OpenCode" : kind === "mcp" ? "MCP 选手" : "MiniMax";
    update(index, { kind, key: "", ...(defaultName ? { name } : {}) });
  }

  function validatePlayer(p: Player) {
    if (p.kind !== "api") return;
    if (!p.key.trim() || !p.model.trim()) throw new Error("请填写模型和 API Key。");
    endpointFor(p);
  }

  async function checkInvite() {
    setError(""); setBusy(true);
    try {
      const { id, token } = parseInvite(joinCode);
      const { state } = await json<{ state: string }>(`/api/arena/${id}/state`, { headers: { "x-seat": token } });
      const parsed = JSON.parse(state) as { game: string; you: string; outcome: unknown };
      if (parsed.game !== "gomoku" || !["black", "white"].includes(parsed.you)) throw new Error("无法识别这个对局。");
      if (parsed.outcome) throw new Error("这局已经结束，无法加入。");
      const seat = parsed.you === "black" ? 0 : 1;
      setJoining({ id, token, seat });
      setPlayers([0, 1].map((i) => i === seat ? { ...initial(0), name: "朋友" } : { ...initial(1), name: "对手" }));
      setStep("join-setup");
    } catch (e) { setError(e instanceof Error && e.message.startsWith("请求失败") ? "口令无效或对局不存在，请确认后重试。" : e instanceof Error ? e.message : "无法加入对局"); }
    finally { setBusy(false); }
  }

  async function joinGame() {
    if (!joining) return;
    setBusy(true);
    try {
      validatePlayer(players[joining.seat]!);
      const name = players[joining.seat]!.name.trim() || "朋友";
      await json(`/api/arena/${joining.id}/join`, { method: "POST", headers: { "x-seat": joining.token, "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const invites: (Invite | null)[] = [null, null];
      invites[joining.seat] = { seat: joining.seat, kind: "ai", name: "我", joined: false, link: `${location.origin}/mcp/seat/${joining.token}` };
      setGame({ id: joining.id, invites }); setJoinCode(""); setJoining(null); setStep("live"); setError(""); setStatus("已加入对局"); setRunning(true);
    } catch (e) { setError(e instanceof Error ? e.message : "配置不完整"); }
    finally { setBusy(false); }
  }

  async function create() {
    setError("");
    try { players.forEach(validatePlayer); } catch (e) { setError(e instanceof Error ? e.message : "配置不完整"); return; }
    setBusy(true);
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (prefs.token()) headers.authorization = `Bearer ${prefs.token()}`;
      // Only names are sent to this server; API keys remain in component memory.
      const created = await json<{ match: { id: string }; invites: Invite[] }>("/api/arena/games", { method: "POST", headers, body: JSON.stringify({ names: players.map((p) => p.name.trim() || (p.kind === "api" ? p.model.trim() : "MCP")) }) });
      setGame({ id: created.match.id, invites: created.invites });
      setStep("live");
      setStatus("对局已创建");
      setRunning(true);
    } catch (e) { setError(e instanceof Error ? e.message : "开局失败"); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!game || !running) return;
    const controller = new AbortController();
    active.current = controller;
    let cancelled = false;
    const run = async () => {
      while (!cancelled) {
        try {
          const manualSeat = players.findIndex((p, i) => p.kind === "manual" && tokenOf(game.invites[i]));
          const manualToken = manualSeat < 0 ? "" : tokenOf(game.invites[manualSeat]);
          const match: MatchView<GomokuView> = (await json<{ match: MatchView<GomokuView> }>(`/api/games/${game.id}`, { signal: controller.signal, ...(manualToken ? { headers: { "x-seat": manualToken } } : {}) })).match;
          setLiveMatch((old) => old && old.id === match.id && old.version > match.version ? old : match);
          if (match.status.outcome) { setStatus(`已结束 · ${match.status.resultText ?? "对局结束"}`); setRunning(false); break; }
          const seat = match.status.waitingOn[0];
          if (seat !== 0 && seat !== 1) throw new Error("无法确定当前座位");
          const player = players[seat]!;
          if (player.kind !== "api") { setStatus(player.kind === "manual" ? "轮到你了，点击棋盘落子" : `等待${player.name || "对手"}落子`); await delay(1500); continue; }
          const link = game.invites[seat]?.link;
          if (!link) throw new Error("没有可用的座位凭证");
          const token = new URL(link).pathname.split("/").pop();
          if (!token) throw new Error("没有可用的座位凭证");
          const headers = { "x-seat": token };
          const { state } = await json<{ state: string }>(`/api/arena/${game.id}/state`, { headers, signal: controller.signal });
          const parsed = JSON.parse(state) as { game: string; you: string; turn: string };
          if (parsed.game !== "gomoku" || parsed.you !== parsed.turn) { await delay(500); continue; }
          setStatus(`${player.name || player.model} 正在思考…`);
          let correction = "";
          let moved = false;
          for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
            const response = await fetch(endpointFor(player), {
              method: "POST", signal: controller.signal, cache: "no-store", redirect: "error", credentials: "omit",
              headers: { "content-type": "application/json", authorization: `Bearer ${player.key.trim()}` },
              body: JSON.stringify({ model: player.model.trim(), ...(player.effort !== "default" ? { reasoning_effort: player.effort } : {}), messages: [{ role: "system", content: "Return only a JSON object with a single move field containing the coordinate." }, { role: "user", content: state + (correction ? `\nPrevious response: ${correction}` : "") }] }),
            });
            if (!response.ok) throw new Error(`模型接口返回 ${response.status}。请检查密钥、地区及模型权限。`);
            const data = await response.json();
            if (data.base_resp?.status_code) throw new Error(`模型接口返回错误代码 ${Number(data.base_resp.status_code)}。`);
            let move: unknown;
            try { move = JSON.parse(data.choices?.[0]?.message?.content ?? "").move; } catch { correction = "response is not JSON"; continue; }
            if (typeof move !== "string" || !/^[A-HJ-P](?:[1-9]|1[0-5])$/i.test(move)) { correction = "move must be a coordinate"; continue; }
            try {
              await json(`/api/arena/${game.id}/move`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ move }), signal: controller.signal });
              moved = true;
              break;
            } catch (e) { if (controller.signal.aborted) throw e; correction = e instanceof Error ? e.message : "move rejected"; }
          }
          if (!moved && !cancelled) throw new Error("模型连续三次没有给出合法走法，对局已暂停。");
          await delay(300);
        } catch (e) {
          if (!cancelled && !controller.signal.aborted) {
            setError(e instanceof TypeError ? "连接失败：模型服务可能不允许浏览器跨域访问，或网络不可用。" : e instanceof Error ? e.message : "对局运行失败");
            setStatus("已暂停");
            setRunning(false);
          }
          break;
        }
      }
    };
    void run();
    return () => { cancelled = true; controller.abort(); if (active.current === controller) active.current = null; };
  }, [game, running, players]);

  async function manualMove(move: string): Promise<boolean> {
    if (!game || manualBusy || !running) return false;
    const seat = players.findIndex((p, i) => p.kind === "manual" && tokenOf(game.invites[i]));
    if (seat < 0) return false;
    const token = tokenOf(game.invites[seat]);
    setManualBusy(true);
    try {
      await json(`/api/arena/${game.id}/move`, { method: "POST", headers: { "x-seat": token, "content-type": "application/json" }, body: JSON.stringify({ move }) });
      const match = (await json<{ match: MatchView<GomokuView> }>(`/api/games/${game.id}`, { headers: { "x-seat": token } })).match;
      setLiveMatch((old) => old && old.id === match.id && old.version > match.version ? old : match);
      setError("");
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "落子失败"); return false; }
    finally { setManualBusy(false); }
  }

  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setStatus("已复制"); } catch { setError("复制失败，请手动选择文本。"); } };
  const next = (s: Step) => { setError(""); setStep(s); };
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const Board = gomokuUI.Board;
  const manualSeat = game ? players.findIndex((p, i) => p.kind === "manual" && tokenOf(game.invites[i])) : -1;

  const playerSetup = (index: number, choices: Player["kind"][], editing = false) => {
    const p = players[index]!;
    const labels: Record<Player["kind"], { title: string; hint: string }> = {
      manual: { title: "自己下棋", hint: "在网页上点击棋盘" },
      friend: { title: "邀请朋友", hint: "发送邀请链接或口令" },
      api: { title: "使用模型 API", hint: "在本页填写自己的 API Key" },
      opencode: { title: "OpenCode", hint: "用 OpenCode 连接座位" },
      mcp: { title: "其他 MCP 客户端", hint: "连接支持 MCP 的 AI" },
    };
    return <div className="space-y-4">
      {!editing && <div className="grid gap-2 sm:grid-cols-2">{choices.map((kind) => <button key={kind} type="button" aria-pressed={p.kind === kind} onClick={() => changeKind(index, kind)} className={`rounded-2xl border px-4 py-3 text-left ${p.kind === kind ? "border-black bg-black text-white" : "border-white/70 bg-white/30"}`}><span className="block font-semibold">{labels[kind].title}</span><span className={`block text-sm ${p.kind === kind ? "text-white/70" : "text-muted"}`}>{labels[kind].hint}</span></button>)}</div>}
      {!editing && p.kind !== "friend" && <label className="block text-sm">显示名称<input className="field mt-1 w-full" maxLength={40} value={p.name} onChange={(e) => update(index, { name: e.target.value })} /></label>}
      {p.kind === "api" && <div className="space-y-3 rounded-2xl bg-white/30 p-4">
        <label className="block text-sm">1. 选择服务商<select className="field mt-1 w-full" value={p.provider} onChange={(e) => { const provider = e.target.value as Provider; const config = providers[provider]; update(index, { provider, model: config.model, key: "", customUrl: "", effort: config.efforts[0]! }); }}>{(Object.keys(providers) as Provider[]).map((id) => <option key={id} value={id}>{providers[id].label}</option>)}</select></label>
        {p.provider === "custom" ? <><label className="block text-sm">API 地址<input className="field mt-1 w-full" type="url" value={p.customUrl} onChange={(e) => update(index, { customUrl: e.target.value })} placeholder="https://example.com/v1" autoComplete="off" /></label><p className="text-sm text-amber-800">密钥会发送给此地址，请确认服务商或代理可信。仅支持 OpenAI Chat Completions 兼容接口。</p></> : <p className="break-all text-xs text-muted">请求地址：{providers[p.provider].url}</p>}
        {p.provider === "tokenhub" && <p className="text-sm text-muted">此接口在测试时未通过浏览器跨域预检，可能无法从网页连接。</p>}
        <label className="block text-sm">2. 模型名称<input className="field mt-1 w-full" maxLength={100} value={p.model} onChange={(e) => update(index, { model: e.target.value })} placeholder="填写模型名称" /></label>
        <label className="block text-sm">3. API Key<input className="field mt-1 w-full" type="password" autoComplete="off" spellCheck={false} value={p.key} onChange={(e) => update(index, { key: e.target.value })} placeholder="只保留在当前页面" /></label>
        <label className="block text-sm">思考强度<select className="field mt-1 w-full" value={p.effort} onChange={(e) => update(index, { effort: e.target.value as Player["effort"] })}>{providers[p.provider].efforts.map((x) => <option key={x} value={x}>{x === "default" ? "服务商默认" : x === "none" ? "关闭" : x}</option>)}</select></label>
        <p className="text-xs text-muted">密钥只在当前页面内存中，直接发给所选模型接口；棋局信息也会发给模型服务商，费用由密钥账户承担。</p>
      </div>}
      {p.kind === "opencode" && <p className="text-sm text-muted">开局后复制专用配置和提示词，在 OpenCode 中使用；模型和密钥由 OpenCode 管理。</p>}
      {p.kind === "mcp" && <p className="text-sm text-muted">开局后复制这个座位的 MCP 地址和提示词，交给支持远程 MCP 的客户端。</p>}
      {p.kind === "friend" && <p className="text-sm text-muted">创建后会给你链接和口令。朋友可选择亲自下棋，或使用自己的 AI。</p>}
    </div>;
  };

  return <>
    <Header status="五子棋 · 新手指引" />
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-6 lg:mx-auto lg:max-w-[760px] lg:overflow-visible">
      {step === "home" && <section className="glass space-y-4 px-5 py-6 lg:px-7">
        <div><p className="text-sm text-muted">西窗 · 五子棋</p><h1 className="mt-1 text-3xl font-bold">一起下一局</h1><p className="mt-2 text-sm text-muted">自己下棋，邀请朋友，或者让 AI 来对弈。跟着步骤设置就能开始。</p></div>
        <button className="btn btn-ink w-full" onClick={() => next("host-self")}>我要创建对局 →</button>
        <button className="btn btn-glass w-full" onClick={() => next("join-code")}>输入口令，加入朋友 →</button>
        <p className="text-xs text-muted">如果使用模型 API，密钥只保存在当前页面，不会发送给本网站服务器。</p>
      </section>}
      {(step === "host-self" || step === "host-opponent") && <section className="glass space-y-5 px-5 py-6 lg:px-7">
        <div><p className="text-sm text-muted">创建对局 · 第 {step === "host-self" ? "1" : "2"} 步，共 2 步</p><h1 className="mt-1 text-2xl font-bold">{step === "host-self" ? "你想怎么参与？" : "对手是谁？"}</h1><p className="mt-1 text-sm text-muted">{step === "host-self" ? "你这边执黑，先下。" : "对手执白；如果邀请朋友，创建后把链接发给他。"}</p></div>
        {step === "host-self" ? playerSetup(0, ["manual", "api", "opencode", "mcp"]) : playerSetup(1, ["friend", "api", "opencode", "mcp"])}
        <div className="flex gap-2"><button className="btn btn-glass flex-1" onClick={() => next(step === "host-self" ? "home" : "host-self")}>上一步</button>{step === "host-self" ? <button className="btn btn-ink flex-1" onClick={() => { try { validatePlayer(players[0]!); next("host-opponent"); } catch (e) { setError(e instanceof Error ? e.message : "配置不完整"); } }}>下一步 →</button> : <button className="btn btn-ink flex-1" disabled={busy} onClick={() => void create()}>{busy ? "正在创建…" : "创建对局"}</button>}</div>
      </section>}
      {step === "join-code" && <section className="glass space-y-4 px-5 py-6 lg:px-7"><div><p className="text-sm text-muted">加入对局 · 第 1 步，共 2 步</p><h1 className="mt-1 text-2xl font-bold">输入朋友给你的口令</h1><p className="mt-1 text-sm text-muted">也可以粘贴完整邀请链接。口令相当于座位钥匙，请勿公开。</p></div><label className="block text-sm">邀请口令或链接<input className="field mt-1 w-full" type="password" autoComplete="off" spellCheck={false} value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="粘贴口令或邀请链接" /></label><div className="flex gap-2"><button className="btn btn-glass flex-1" onClick={() => next("home")}>返回</button><button className="btn btn-ink flex-1" disabled={busy || !joinCode.trim()} onClick={() => void checkInvite()}>{busy ? "正在检查…" : "下一步 →"}</button></div></section>}
      {step === "join-setup" && joining && <section className="glass space-y-5 px-5 py-6 lg:px-7"><div><p className="text-sm text-muted">加入对局 · 第 2 步，共 2 步</p><h1 className="mt-1 text-2xl font-bold">你想怎么参与？</h1><p className="mt-1 text-sm text-muted">口令有效，你是{joining.seat === 0 ? "黑方，先下" : "白方"}。</p></div>{playerSetup(joining.seat, ["manual", "api", "opencode", "mcp"])}<div className="flex gap-2"><button className="btn btn-glass flex-1" onClick={() => next("join-code")}>上一步</button><button className="btn btn-ink flex-1" disabled={busy} onClick={() => void joinGame()}>{busy ? "正在进入…" : "进入对局 →"}</button></div></section>}
      {step === "live" && game && <>
        <section className="glass space-y-3 px-5 py-5 lg:px-7"><div><p className="text-sm text-muted">对局进行中</p><h1 className="text-xl font-bold">{status}</h1></div>
          {liveMatch && <div className="mx-auto aspect-square w-full max-w-[460px] rounded-2xl bg-white/25 p-2"><Board match={liveMatch} view={liveMatch.view} me={liveMatch.me} canAct={running && !manualBusy && manualSeat >= 0 && liveMatch.me === manualSeat && liveMatch.status.waitingOn.includes(manualSeat) && !liveMatch.status.outcome} send={manualMove} toast={setError} compact /></div>}
          {manualSeat >= 0 && <p className="text-sm text-muted">你执{manualSeat === 0 ? "黑" : "白"}。轮到你时，电脑点击棋盘落子；手机在同一位置点两次确认。</p>}
          <a className="btn btn-glass w-full" href={`/g/${game.id}`} target="_blank" rel="noopener noreferrer">在新标签页观战 ↗</a>
        </section>
        {players.map((p, i) => {
          const link = game.invites[i]?.link;
          if (!link || p.kind === "api" || p.kind === "manual") return null;
          const token = tokenOf(game.invites[i]);
          if (p.kind === "friend") {
            const invitation = `${location.origin}/arena#seat=${encodeURIComponent(token)}`;
            return <section key={i} className="glass space-y-3 px-5 py-5 lg:px-7"><div><p className="text-sm text-muted">接下来 · 邀请朋友</p><h2 className="text-xl font-bold">把座位发给朋友</h2><p className="mt-1 text-sm text-muted">朋友打开链接，或在本站输入口令后，选择自己下棋或使用 AI。</p></div>{localHost && <p className="text-sm text-amber-800">这是本机测试地址，另一台设备无法使用；公开部署后才可邀请远程朋友。</p>}<div className="flex flex-wrap gap-2"><button className="btn btn-ink" onClick={() => void copy(invitation)}>复制邀请链接</button><button className="btn btn-glass" onClick={() => void copy(token)}>复制口令</button></div><details><summary className="cursor-pointer text-sm">查看口令</summary><code className="mt-2 block break-all text-xs">{token}</code></details><p className="text-xs text-muted">链接和口令都能控制这个座位，只发给你信任的朋友。</p></section>;
          }
          const instruction = prompt(p.kind === "opencode" ? `west-window-${i === 0 ? "black" : "white"}` : "西窗");
          return <section key={i} className="glass space-y-3 px-5 py-5 lg:px-7"><div><p className="text-sm text-muted">接下来 · 连接 {p.kind === "opencode" ? "OpenCode" : "MCP 客户端"}</p><h2 className="text-xl font-bold">连接{i === 0 ? "黑方" : "白方"}选手</h2></div><p className="text-sm text-muted">地址包含座位口令，不要公开。将其添加到你的 MCP 客户端后，发送下面的提示词。</p><code className="block break-all text-xs">{link}</code><div className="flex flex-wrap gap-2"><button className="btn btn-glass" onClick={() => void copy(link)}>复制 MCP 地址</button><button className="btn btn-glass" onClick={() => void copy(instruction)}>复制提示词</button></div><p className="text-sm">{instruction}</p>{p.kind === "opencode" && <div className="space-y-2 border-t border-black/10 pt-3"><b>OpenCode · 3 步接入</b><ol className="list-decimal space-y-1 pl-5 text-sm text-muted"><li>复制下面的配置，合并到项目 opencode.json 或 ~/.config/opencode/opencode.json；保留原有设置。</li><li>启动或重新打开 OpenCode，可用 opencode mcp list 检查连接。</li><li>把上面的提示词发给 OpenCode，等待它落子。</li></ol><pre className="overflow-x-auto rounded-xl bg-black/80 p-3 text-xs text-white">{openCodeConfig(link, i)}</pre><button className="btn btn-glass" onClick={() => void copy(openCodeConfig(link, i))}>复制 OpenCode 配置</button><p className="text-xs text-muted">配置含座位口令，不能提交到公开仓库。远程设备需要能访问该网址。</p></div>}</section>;
        })}
        <section className="glass space-y-3 px-5 py-5 lg:px-7"><div className="flex flex-wrap gap-2"><button className="btn btn-glass" onClick={() => { setError(""); if (running) { setStatus("已暂停"); setRunning(false); } else { try { players.forEach(validatePlayer); setRunning(true); } catch (e) { setError(e instanceof Error ? e.message : "配置不完整"); } } }}>{running ? "暂停本页" : "继续"}</button><button className="btn btn-glass" onClick={() => { active.current?.abort(); setRunning(false); setGame(null); setLiveMatch(null); setPlayers([initial(0), initial(1)]); setStatus("准备开局"); setError(""); setStep("home"); }}>退出并清除密钥</button></div>
          {!running && !liveMatch?.status.outcome && players.map((p, i) => p.kind === "api" && tokenOf(game.invites[i]) ? <details key={i}><summary className="cursor-pointer text-sm">{i === 0 ? "黑方" : "白方"} · 修改模型或密钥</summary><div className="mt-2">{playerSetup(i, ["api"], true)}</div></details> : null)}
          {players.map((p, i) => (p.kind === "manual" || p.kind === "api") && tokenOf(game.invites[i]) ? <details key={i}><summary className="cursor-pointer text-sm">{i === 0 ? "黑方" : "白方"} · 保存重新加入口令</summary><p className="mt-1 text-xs text-muted">口令可以控制此座位，请妥善保存，不要公开。</p><code className="mt-1 block break-all text-xs">{tokenOf(game.invites[i])}</code><button className="btn btn-glass mt-2" onClick={() => void copy(tokenOf(game.invites[i]))}>复制自己的口令</button></details> : null)}
          <p className="text-xs text-muted">请保持本页打开；刷新或离开后，本页选手会停止且密钥被清除。保存自己的口令可重新加入。浏览器对局的模型统计暂不会自动写入 SQLite 数据库。</p></section>
      </>}
      {error && <div role="alert" className="glass px-5 py-4 text-sm text-red-800">{error}</div>}
    </div>
  </>;
}
