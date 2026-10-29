import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { PLAY_CONNECTOR, PROVIDERS, endpointFor, playConnectorCommand, playConnectorUrl, type Provider } from "../ai";
import { api, prefs } from "../api";
import { botKey, deleteBot, newBot, saveBot, useBots, type MyBot } from "../bots";
import { AVATARS, AVATAR_IDS, Avatar } from "../components/Avatar";
import { Sheet } from "../components/Chat";
import { IconCopy } from "../components/icons";
import { Pill } from "../components/Pill";
import { Header, useWide } from "../components/Shell";
import { useToast } from "../components/Toast";

const card = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35 } };

const TOOLS: [string, string][] = [
  ["list_game_types", "有哪些游戏、规则和选项"],
  ["new_game", "开新局，返回链接"],
  ["list_games", "列出对局"],
  ["get_state", "看棋盘或牌桌、轮到谁"],
  ["play", "走一步，可以顺便说一句话"],
  ["wait_for_opponent", "挂起等你，最长约 50 秒"],
  ["resign", "认输"],
  ["rename", "改你或 AI 的名字"],
  ["say", "给你发一句悄悄话"],
];

export function Connect() {
  const toast = useToast();
  const wide = useWide();
  const [authRequired, setAuthRequired] = useState(true);
  useEffect(() => {
    api.config().then((c) => setAuthRequired(c.authRequired), () => {});
  }, []);
  const token = prefs.token();
  const url = `${location.origin}/mcp${authRequired ? `/${token || "<ACCESS_TOKEN>"}` : ""}`;
  const copy = (s: string) =>
    navigator.clipboard.writeText(s).then(
      () => toast.show("已复制"),
      () => toast.show("复制失败，请手动选择"),
    );

  const cmd = `claude mcp add --transport http rain-go ${url}`;
  const bots = useBots();
  const [editing, setEditing] = useState<MyBot | null>(null);
  return (
    <>
      {toast.node}
      <Header status="MCP" />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto lg:block lg:space-y-5 lg:overflow-visible xl:grid xl:grid-cols-2 xl:items-start xl:gap-5 xl:space-y-0">
        <motion.div {...card} className="[@media(max-height:700px)]:hidden lg:!block xl:col-span-2">
          <Pill title="Connect" subtitle="设置你的 Bot，或把西窗接到你的 AI" />
        </motion.div>

        <motion.section {...card} className="glass shrink-0 px-5 py-4 lg:px-7 lg:py-6">
          <div className="flex items-baseline justify-between">
            <div className="text-[1.35rem] font-bold lg:text-[1.9rem]">我的 Bot</div>
            <span className="text-sm text-muted">存在这台设备上</span>
          </div>
          <p className="mt-1 text-sm text-muted">在房间的空座上放入你的 Bot。API Bot 由你这个页面调用模型代下；MCP Bot 会拿到一段带座位口令的提示词，交给你的 agent。</p>
          <div className="mt-3 space-y-1.5">
            {bots.map((b) => (
              <button key={b.id} onClick={() => setEditing(b)} className="flex w-full items-center gap-3 rounded-2xl bg-white/35 px-3 py-2 text-left transition hover:bg-white/55">
                <Avatar id={b.avatar} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{b.name || "未命名"}</span>
                  <span className="block truncate text-sm text-muted">
                    {b.type === "api" ? `API · ${PROVIDERS[b.provider].label} · ${b.model}${botKey(b.id) ? "" : " · 缺密钥"}` : "MCP · 你的 agent 接入"}
                  </span>
                </span>
                <span className="text-faint">›</span>
              </button>
            ))}
            <button className="btn btn-ink w-full" onClick={() => setEditing(newBot())}>
              新建 Bot
            </button>
          </div>
        </motion.section>

        <motion.section {...card} className="glass shrink-0 px-5 py-4 lg:px-7 lg:py-6">
          <div className="flex items-baseline justify-between">
            <div className="text-[1.35rem] font-bold lg:text-[1.9rem]">玩家连接器</div>
            <span className="text-sm text-muted">每个站点加一次</span>
          </div>
          <p className="mt-1 text-sm text-muted">
            让你的 agent 坐进别人的房间用这个。加一次「{PLAY_CONNECTOR}」，以后每局只要把房主给的提示词（带座位口令）发给 agent，不用再加连接器，也不用重开会话。
          </p>
          <code
            className="mt-2 block cursor-pointer overflow-x-auto whitespace-nowrap rounded-xl bg-black/80 px-3 py-2 font-mono text-xs text-white lg:text-sm"
            onClick={() => copy(playConnectorCommand())}
          >
            {playConnectorCommand()}
          </code>
          <div className="mt-2 flex items-center gap-2">
            <code className="field flex !min-h-[40px] items-center overflow-x-auto whitespace-nowrap font-mono text-sm">{playConnectorUrl()}</code>
            <button className="btn btn-ink !min-h-[40px] !px-3.5" onClick={() => copy(playConnectorUrl())} aria-label="复制玩家连接器地址">
              <IconCopy width={18} height={18} />
            </button>
          </div>
          <p className="mt-2 text-xs text-faint">Claude Code 运行上面那行；Claude 网页或 App 在「设置 → 连接器」里添加这个地址。它本身不带任何口令，可以放心保存。</p>
        </motion.section>

        <motion.section {...card} className="glass shrink-0 px-5 py-4 lg:px-7 lg:py-6">
          <div className="text-[1.05rem] text-ink-2 lg:text-[1.5rem]">Connector URL</div>
          <div className="mt-2 flex items-center gap-2 lg:mt-3">
            <code className="field flex !min-h-[44px] items-center overflow-x-auto whitespace-nowrap font-mono text-sm">{url}</code>
            <button className="btn btn-ink !min-h-[44px] !px-3.5" onClick={() => copy(url)} aria-label="复制链接">
              <IconCopy width={20} height={20} />
            </button>
          </div>
          {authRequired && (
            <p className="mt-2 text-xs text-faint lg:text-sm">
              链接里带着访问口令，别发给别人。{!token && "先在右上角设置里填口令，这里会自动补全。"}
            </p>
          )}
        </motion.section>

        <motion.section {...card} className="glass shrink-0 px-5 py-4 lg:px-7 lg:py-6">
          <div className="text-[1.35rem] font-bold lg:text-[1.9rem]">How to</div>
          <ol className="mt-2 space-y-2.5 text-[0.95rem] lg:mt-3 lg:space-y-3 lg:text-[1.05rem]">
            <li className="stat-bar">
              <b>Claude 网页或 App</b>：设置 → 连接器 → 添加自定义连接器，粘贴上面的链接。
            </li>
            <li className="stat-bar">
              <b>Claude Code</b>：点下面这行复制，在终端运行。
              <code
                className="mt-1.5 block cursor-pointer overflow-x-auto whitespace-nowrap rounded-xl bg-black/80 px-3 py-2 font-mono text-xs text-white lg:text-sm"
                onClick={() => copy(cmd)}
              >
                {cmd}
              </code>
            </li>
            <li className="stat-bar">然后对 AI 说：「我们来玩一局五子棋吧」。它会开局，把链接发给你。</li>
          </ol>
        </motion.section>

        <motion.details {...card} className="glass shrink-0 px-5 py-3.5 lg:px-7 lg:py-6 xl:col-span-2" open={wide}>
          <summary className="flex cursor-pointer list-none items-baseline justify-between">
            <span className="text-[1.35rem] font-bold lg:text-[1.9rem]">Tools</span>
            <span className="text-sm text-muted">{TOOLS.length} 个工具 · 点开查看</span>
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:gap-3 xl:grid-cols-3">
            {TOOLS.map(([name, desc]) => (
              <div key={name} className="stat-bar">
                <div className="font-mono text-xs lg:text-sm">{name}</div>
                <div className="text-sm text-muted">{desc}</div>
              </div>
            ))}
          </div>
        </motion.details>
      </div>
      {editing && <BotEditor bot={editing} isNew={!bots.some((b) => b.id === editing.id)} onClose={() => setEditing(null)} toast={toast.show} />}
    </>
  );
}

function BotEditor({ bot: initial, isNew, onClose, toast }: { bot: MyBot; isNew: boolean; onClose: () => void; toast: (m: string) => void }) {
  const [bot, setBot] = useState(initial);
  const [key, setKey] = useState(() => botKey(initial.id));
  const [error, setError] = useState("");
  const set = (patch: Partial<MyBot>) => setBot((b) => ({ ...b, ...patch }));
  const provider = PROVIDERS[bot.provider];

  const save = () => {
    if (!bot.name.trim()) return setError("给 Bot 起个名字。");
    if (bot.type === "api") {
      if (!bot.model.trim()) return setError("填写模型名称。");
      try {
        endpointFor(bot);
      } catch (e) {
        return setError(e instanceof Error ? e.message : "接口地址不对");
      }
    }
    saveBot({ ...bot, name: bot.name.trim().slice(0, 40), model: bot.model.trim() }, key);
    toast("已保存");
    onClose();
  };

  return (
    <Sheet title={isNew ? "新建 Bot" : "编辑 Bot"} onClose={onClose}>
      <div className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <div className="flex items-center gap-3">
          <Avatar id={bot.avatar} size={56} />
          <input className="field" value={bot.name} onChange={(e) => set({ name: e.target.value })} placeholder="名字，比如 小鲸" maxLength={40} />
        </div>
        <div>
          <div className="mb-1.5 text-sm text-muted">头像</div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {AVATAR_IDS.map((id) => (
              <button
                key={id}
                onClick={() => set({ avatar: id })}
                aria-pressed={bot.avatar === id}
                className={`flex flex-col items-center gap-1 rounded-2xl p-1.5 text-[0.7rem] text-muted ${bot.avatar === id ? "bg-ink text-white" : "bg-white/30"}`}
              >
                <Avatar id={id} size={40} />
                {AVATARS[id]!.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-sm text-muted">类型</div>
          <div className="seg" role="group" aria-label="类型">
            <button aria-pressed={bot.type === "api"} onClick={() => set({ type: "api" })}>
              API
            </button>
            <button aria-pressed={bot.type === "mcp"} onClick={() => set({ type: "mcp" })}>
              MCP
            </button>
          </div>
        </div>
        {bot.type === "api" ? (
          <div className="space-y-3 rounded-2xl bg-white/30 p-4">
            <label className="block text-sm">
              服务商
              <select
                className="field mt-1"
                value={bot.provider}
                onChange={(e) => {
                  const p = e.target.value as Provider;
                  set({ provider: p, model: PROVIDERS[p].model, customUrl: "", effort: PROVIDERS[p].efforts[0]! });
                }}
              >
                {(Object.keys(PROVIDERS) as Provider[]).map((id) => (
                  <option key={id} value={id}>
                    {PROVIDERS[id].label}
                  </option>
                ))}
              </select>
            </label>
            {bot.provider === "custom" && (
              <label className="block text-sm">
                API 地址
                <input className="field mt-1" type="url" value={bot.customUrl} onChange={(e) => set({ customUrl: e.target.value })} placeholder="https://example.com/v1" autoComplete="off" />
                <span className="mt-1 block text-xs text-amber-800">密钥会发送给这个地址，请确认它可信。只支持 OpenAI Chat Completions 格式。</span>
              </label>
            )}
            <label className="block text-sm">
              模型
              <input className="field mt-1" value={bot.model} onChange={(e) => set({ model: e.target.value })} maxLength={100} placeholder="模型名称" />
            </label>
            <label className="block text-sm">
              API Key
              <input className="field mt-1" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" />
            </label>
            {provider.efforts.length > 1 && (
              <label className="block text-sm">
                思考强度
                <select className="field mt-1" value={bot.effort} onChange={(e) => set({ effort: e.target.value as MyBot["effort"] })}>
                  {provider.efforts.map((x) => (
                    <option key={x} value={x}>
                      {x === "default" ? "服务商默认" : x === "none" ? "关闭" : x}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={bot.rememberKey} onChange={(e) => set({ rememberKey: e.target.checked })} />
              在这台设备上记住密钥
            </label>
            <p className="text-xs text-muted">
              不勾选时密钥只保留到关闭这个标签页。密钥只从你的浏览器直接发给模型服务商，不经过西窗服务器；棋局内容也会发给服务商，费用由这个密钥的账户承担。部分服务商不允许浏览器跨域调用。
            </p>
          </div>
        ) : (
          <p className="rounded-2xl bg-white/30 p-4 text-sm text-muted">
            把这个 Bot 放进房间的空座后，会得到一段带座位口令的提示词。agent 加过一次「{PLAY_CONNECTOR}」玩家连接器（见「连接」页）后，把提示词发给它，它就以这个名字和头像入座。
          </p>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
      <div className="mt-4 flex shrink-0 gap-2">
        {!isNew && (
          <button
            className="btn btn-glass"
            onClick={() => {
              deleteBot(bot.id);
              onClose();
            }}
          >
            删除
          </button>
        )}
        <button className="btn btn-ink flex-1" onClick={save}>
          保存
        </button>
      </div>
    </Sheet>
  );
}
