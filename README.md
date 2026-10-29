# 西窗 · West Window

一个可以连接到 AI 的 MCP 服务器：人在手机网页上，AI 通过 MCP 工具，在同一张桌上下棋、打牌、玩大富翁。
一张桌可以坐好几个人：你、朋友、一个或几个 AI，缺人时用机器人补位。
名字取自李商隐「何当共剪西窗烛，却话巴山夜雨时」。

## 游戏

| 类别 | 游戏 | 落子写法 |
|---|---|---|
| 棋 | 围棋 | `D4`、`pass`，数子阶段 `dead C3`、`accept`、`resume` |
| 棋 | 五子棋 | `H8` |
| 棋 | 黑白棋 | `d3` |
| 棋 | 国际象棋 | `e2e4`、`e7e8q` |
| 棋 | 中国象棋 | `h2e2` |
| 牌 | 德州扑克（两人单挑） | `call`、`raise 120`、`fold` |
| 牌 | 跑得快（两人版） | `3 3`、`10 J Q K A`、`pass` |
| 牌 | 斗地主（三人，第三家是机器人） | `bid 3`、`3 3 3 4`、`pass` |
| 骰 | 大富翁（两人版） | `roll`、`buy`、`build 夜雨`、`end` |
| 骰 | 飞行棋（两人版） | `roll`、`move 2`、`launch` |

棋子是雨窗上的水珠。围棋里横竖相连的同色棋子会融成一滴。
牌局里各看各的手牌：服务端给每一方单独生成视图，AI 看不到你的牌，网页也拿不到 AI 的牌。

显示名称集中在 `apps/web/src/brand.ts` 和 `apps/worker/src/mcp.ts` 开头的说明里，改名只要改这两处。
内部标识统一用 `rain-go`。

## 座位与多人

每局按座位编号，座位 0 先走。每个座位可以是：

| 座位 | 怎么坐进来 |
|---|---|
| 你 | 开局时选「你」，这台设备记住你的座位 |
| 朋友 | 开局后打开邀请面板，把他那个座位的链接发给他，他用自己的手机打开就能坐下 |
| AI | 你自己的 AI 用连接器开局，或调用 `join_game` 认领空的 AI 座位；别人的 AI 用那个座位的专用连接地址 `/mcp/seat/<座位口令>` 接入，只能玩这一个座位 |
| 机器人 | 由游戏自带的规则机器人自动出招 |

没有座位的人打开对局链接就是观战，看不到任何人的手牌。每个浏览器只收到自己座位的视图，AI 也只能读到自己座位的描述。

| 游戏 | 人数 |
|---|---|
| 围棋、五子棋、黑白棋、国际象棋、中国象棋 | 2 |
| 跑得快 | 2 到 3 |
| 斗地主 | 3 |
| 大富翁、飞行棋 | 2 到 4 |
| 德州扑克 | 2 到 6 |

## 结构

| 目录 | 内容 |
|---|---|
| `packages/engine/src/match` | 通用对局层：游戏模块接口、可复现的随机数、走子、认输、聊天、改名、按玩家生成视图、给 AI 的文字描述 |
| `packages/engine/src/games` | 每种游戏一个纯函数规则模块 |
| `apps/worker` | Cloudflare Worker：Hono 路由、MCP 服务器（Streamable HTTP，无状态）、每局一个 Durable Object、对局列表 Durable Object |
| `apps/web` | React + Vite + Tailwind v4 + Motion 前端。`src/games/<kind>` 是每种游戏的界面，`src/components/MatchScreen.tsx` 是共用的对局页 |

新增一种游戏的约定写在 [docs/ADDING_A_GAME.md](docs/ADDING_A_GAME.md)。

AI 通过 MCP 工具走子，人在网页上走子，两边通过同一个 Durable Object 同步。
AI 调用 `wait_for_opponent` 会挂起，直到轮到它。

## 模型擂台

五子棋支持 API 模型自动对战，也可与外部 MCP 选手混合对局；启动、配置与注意事项见 [docs/ARENA.md](docs/ARENA.md)。

## MCP 工具

| 工具 | 作用 |
|---|---|
| `list_game_types` | 能玩哪些游戏，每种的人数、完整规则、选项和落子写法 |
| `new_game` | 开新局，`seats` 按顺序写每个座位是 human、ai 还是 bot；返回每位朋友的链接和其他 AI 座位的连接地址 |
| `join_game` | 认领一局里空着的 AI 座位，返回座位口令 |
| `list_games` | 列出对局 |
| `get_state` | 当前棋盘或牌桌、轮到谁、合法走法、最近的悄悄话 |
| `play` | 走一步，可附带一句话 |
| `wait_for_opponent` | 等人走，最长约 50 秒，超时就再调一次 |
| `resign` | 认输 |
| `rename` | 改你或 AI 的显示名字，网页立刻更新 |
| `say` | 给人发一句话 |

不传 `game_id` 时，默认用最近活跃的未结束对局。一局里有多个 AI 座位时，每个 AI 调用时都要带上自己的座位口令 `seat`。座位专用连接器只有 `get_state`、`play`、`wait_for_opponent`、`resign`、`rename`、`say`。

## 本地开发

```bash
pnpm install
echo 'ACCESS_TOKEN=devtoken' > apps/worker/.dev.vars
pnpm dev                              # 构建前端并在 http://127.0.0.1:8787 启动 Worker
pnpm --filter @rain-go/worker smoke  # 另开终端：端到端跑一遍 MCP 对局流程
pnpm --filter @rain-go/worker all-games  # 9 种游戏各开一局走几步，并检查牌局不泄露 AI 的手牌
pnpm --filter @rain-go/worker seed   # 造一局有长棋块和提子的演示棋
pnpm --filter @rain-go/worker ai-pass <id> [move]  # 让 AI 走一步，默认停一手
pnpm test                             # 规则引擎单元测试
pnpm typecheck
```

改前端时可以用 `pnpm dev:web`，Vite 会把 `/api` 和 `/mcp` 代理到 8787 端口。

打开 `/sandbox/<kind>`（例如 `/sandbox/chess`）可以不连服务器，在一个屏幕上替两边走子。「AI 视角」按钮显示 AI 通过 MCP 收到的原文。

宽度小于 1000px 时，每一页都固定在一屏内，不需要滚动：棋盘按剩余高度缩放，聊天记录和输入框收在聊天按钮里。宽屏是两栏布局，可以正常滚动。

## 部署到 Cloudflare

```bash
npx wrangler login
cd apps/worker && npx wrangler secret put ACCESS_TOKEN   # 设一个足够长的随机口令
cd ../.. && pnpm deploy
```

部署完会得到一个 `*.workers.dev` 地址。
要用自己的域名，比如 `go.ombre-lunare.top`，在 Cloudflare 面板里给这个 Worker 添加自定义域名即可，也可以在 `apps/worker/wrangler.jsonc` 里加 `routes`。

## 连接到 AI

连接器地址是 `https://<你的域名>/mcp/<ACCESS_TOKEN>`，网页的「连接」页会自动生成并提供复制。

- **Claude 网页或 App**：设置 → 连接器 → 添加自定义连接器，粘贴上面的地址。
- **Claude Code**：`claude mcp add --transport http rain-go https://<你的域名>/mcp/<ACCESS_TOKEN>`

然后对 AI 说「我们来下一盘围棋吧」。

## 权限说明

- MCP 端点、创建对局、查看对局列表和邀请链接，需要 `ACCESS_TOKEN`。
  口令可以放在路径里、`?token=` 参数里，或 `Authorization: Bearer` 头里。
- 在网页上走子需要这个座位自己的座位口令，站点口令本身不能替任何座位走子。座位口令只出现在邀请链接和连接地址里，任何视图里都没有。
- 知道对局链接但没有座位口令的人只能观战，链接里的对局 id 是 12 位随机串。
- 没有设置 `ACCESS_TOKEN` 时所有接口都是开放的，只适合本地开发。

## 规则

每种游戏的完整规则写在各自模块的 `rules` 字段里，AI 调用 `list_game_types` 就能读到。
围棋按中国规则数子，默认贴 7.5 目。双方连续停一手后进入数子阶段：点水珠标记死活，双方都接受后出结果。

双方的名字随时可以改：手机上点棋盘下方的名字按钮，电脑上点「改名」，也可以让 AI 调用 `rename`。
用过的名字会记在这台设备上，改名时点一下就能换上，还能一键互换两边的名字。
