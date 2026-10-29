/**
 * Calling an OpenAI-compatible Chat Completions API straight from the browser, so a person's own
 * model can play their seat. Keys go only to the chosen endpoint, never to this site's server.
 */

export type Provider = "minimax-cn" | "minimax-global" | "deepseek" | "qwen" | "volcengine" | "tokenhub" | "custom";
export type Effort = "default" | "none" | "low" | "medium" | "high" | "xhigh" | "max";

export const PROVIDERS: Record<Provider, { label: string; url: string; model: string; efforts: Effort[] }> = {
  "minimax-cn": { label: "MiniMax 国内版", url: "https://api.minimaxi.com/v1/chat/completions", model: "MiniMax-M3.1-Flash", efforts: ["low", "medium", "high", "xhigh", "max"] },
  "minimax-global": { label: "MiniMax 国际版", url: "https://api.minimax.io/v1/chat/completions", model: "MiniMax-M3.1-Flash", efforts: ["low", "medium", "high", "xhigh", "max"] },
  deepseek: { label: "DeepSeek", url: "https://api.deepseek.com/chat/completions", model: "deepseek-flash", efforts: ["default", "none", "low", "high", "max"] },
  qwen: { label: "阿里云百炼", url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-plus", efforts: ["default"] },
  volcengine: { label: "火山方舟", url: "https://ark.cn-beijing.volces.com/api/v3/chat/completions", model: "doubao-seed-2-1-pro-260915", efforts: ["default"] },
  tokenhub: { label: "腾讯云 TokenHub", url: "https://tokenhub.tencentmaas.com/v1/chat/completions", model: "", efforts: ["default"] },
  custom: { label: "自定义 OpenAI 兼容接口", url: "", model: "", efforts: ["default"] },
};

export interface ModelConfig {
  provider: Provider;
  customUrl: string;
  model: string;
  effort: Effort;
  key: string;
}

export function endpointFor(c: Pick<ModelConfig, "provider" | "customUrl">): string {
  const input = c.provider === "custom" ? c.customUrl.trim() : PROVIDERS[c.provider].url;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("请输入有效的模型接口地址。");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("接口地址必须使用 HTTPS；本机地址可使用 HTTP。");
  if (url.username || url.password || url.search || url.hash) throw new Error("接口地址不能包含账号、密码、查询参数或片段。");
  if (url.origin === location.origin) throw new Error("模型接口不能指向本网站服务器。");
  if (!/\/chat\/completions\/?$/.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/$/, "")}/chat/completions`;
  return url.href;
}

export function validateModel(c: ModelConfig) {
  if (!c.key.trim() || !c.model.trim()) throw new Error("请填写模型和 API Key。");
  endpointFor(c);
}

/** Asks the model for one move. `correction` explains why its previous answer was rejected. */
export async function askMove(c: ModelConfig, table: string, moveHelp: string, correction: string, signal?: AbortSignal): Promise<string | null> {
  const response = await fetch(endpointFor(c), {
    method: "POST",
    signal,
    cache: "no-store",
    redirect: "error",
    credentials: "omit",
    headers: { "content-type": "application/json", authorization: `Bearer ${c.key.trim()}` },
    body: JSON.stringify({
      model: c.model.trim(),
      ...(c.effort !== "default" ? { reasoning_effort: c.effort } : {}),
      messages: [
        {
          role: "system",
          content: `You are playing a game at a shared table. Read the table and choose a strong legal move. Move syntax: ${moveHelp}\nReturn only a JSON object like {"move": "..."} with the move as a string.`,
        },
        { role: "user", content: table + (correction ? `\n\nYour previous answer was rejected: ${correction}` : "") },
      ],
    }),
  });
  if (!response.ok) throw new Error(`模型接口返回 ${response.status}。请检查密钥、地区及模型权限。`);
  const data = await response.json();
  if (data.base_resp?.status_code) throw new Error(`模型接口返回错误代码 ${Number(data.base_resp.status_code)}。`);
  const content = String(data.choices?.[0]?.message?.content ?? "");
  // Reasoning models sometimes wrap the JSON in prose or a code fence.
  const json = /\{[\s\S]*\}/.exec(content)?.[0];
  try {
    const move = (JSON.parse(json ?? "") as { move?: unknown }).move;
    return typeof move === "string" && move.trim() ? move.trim() : null;
  } catch {
    return null;
  }
}

/** The one player connector a person adds per site; each game's seat code goes in the prompt. */
export const PLAY_CONNECTOR = "xichuang";
export const playConnectorUrl = () => `${location.origin}/mcp/play`;

/**
 * What to send the agent for one game. The seat code names the room and the seat, so the connector
 * itself never decides which game is played and an old game cannot answer instead.
 */
export const mcpPrompt = (seatCode: string, room: string, game: string) =>
  `请用「${PLAY_CONNECTOR}」MCP 连接器玩这局${game}（房间号 ${room}）。每次调用它的工具都把 seat 参数设为这一局的座位口令：${seatCode}（不要用以前对局的口令）。先调用 get_state，把状态里的「Watch link」观战链接发给我（只读，只能看到你自己的牌）。轮到你时用 play 提交合法走法；否则调用 wait_for_opponent 等待，超时后继续等待，直到对局结束。房间没坐满时也请一直等待。`;
