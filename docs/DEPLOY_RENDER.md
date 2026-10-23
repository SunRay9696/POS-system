# Render 试用部署

本指南用于已有的 Render Web Service。当前 POS 仍为演示版：现金记录也标记为演示交易，电子支付没有真实扣款，MyInvois 仅生成未提交草稿。

## 修改现有服务

在 Render 中打开 `TSB POS-system`，进入左侧 `Settings`。使用仓库 `SunRay9696/POS-system` 的 `main` 分支，仓库根目录即为项目目录。

| 设置 | 值 |
| --- | --- |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Node.js | 使用项目指定的 Node.js 24 系列；删除覆盖项目版本的旧 `NODE_VERSION` 设置，或将其设为平台提供的兼容 24 系列版本 |

安装时必须保留开发依赖：构建需要 TypeScript/Vite，当前启动仍通过 `tsx` 运行服务。命令中的 `&&` 会保留安装失败的结果。

在环境变量设置中填写：

| 变量 | 值 |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PUBLIC_BASE_URL` | Render 为此服务实际分配的 HTTPS 网址，无尾部路径；不要照抄示例域名 |
| `COOKIE_SECURE` | `true` |
| `STAFF_PIN` | 自己设置的独立员工 PIN，仅在 Render 设置中输入 |

不要覆盖 Render 分配的 `PORT`。`HOST=0.0.0.0` 让平台能连接应用；`PUBLIC_BASE_URL` 用于 HTTPS 请求来源校验和顾客点餐二维码。密钥、PIN 和 `.env` 不要提交到 GitHub，也不要粘贴到聊天。

保存后，在 `Deploys` 中重新部署最新提交。若平台自动部署已启用，GitHub 的新提交也会触发部署。日志应依次显示构建完成、执行 `npm start`、服务监听 `0.0.0.0` 和平台分配的端口，最后由 Render 确认服务可用。

## 数据保存

免费实例可用于短期查看演示界面，但其临时文件系统不能可靠保留 SQLite 数据。重新部署或实例被替换后，订单、库存和费用可能丢失。先不要在免费实例中记录真实营业数据。

需要保留试用记录时，在决定付费后配置支持持久化磁盘的实例：

- 创建一块持久化磁盘，例如 1 GB，挂载路径 `/var/data`。
- 设置 `DATABASE_PATH=/var/data/squarebox.sqlite`。SQLite 主文件和关联 WAL 文件会放在该目录。
- 保持单个服务实例；当前 SQLite 和进程内员工会话尚未支持多副本扩容。

本地云环境的演示数据库没有推送到 GitHub，Render 首次启动会建立自己的演示数据库。更改数据库路径会切换到另一个数据库，不会自动搬迁旧记录。收费规格、磁盘费用及可用区域以控制台当前显示为准；本项目配置不会自动升级套餐或购买磁盘。

## 部署后检查

使用 Render 实际提供的 HTTPS 网址进行检查：

1. 打开 `/api/health`，确认 JSON 中有 `ok: true`。
2. 打开首页，使用自己配置的员工 PIN 登录，查看库存和报表。
3. 打开 `/order`，确认顾客菜单可加载。执行一笔模拟电子支付，再回到员工界面确认订单与库存更新。
4. 打开扫码点餐，确认二维码链接指向实际 HTTPS 网址，而非本机地址。

免费实例闲置后会休眠，第一次访问可能需要等待。该提示本身不是部署失败的错误。

## 部署失败时

部署列表中的 `Deploy failed` 只说明失败结果；截图中的安装起始日志不足以确定原因。把日志滚动至最底部，查看最后的错误：

- `No open ports detected`、端口扫描超时：核对 `HOST=0.0.0.0`、平台 `PORT` 和启动命令。
- `tsc` / `tsx` 不存在：核对安装命令保留了开发依赖。
- SQLite 导入或 Node 参数报错：核对实际启动的 Node.js 版本属于支持的 24 系列。
- 页面打开但登录返回 `403`：核对 `PUBLIC_BASE_URL` 与浏览器地址栏的 HTTPS 来源一致。

只分享最后 20–30 行相关错误即可，并先隐去任何凭证。不要把顶部免费实例休眠提示当作失败原因。
