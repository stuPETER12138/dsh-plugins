# 任务完成与等待确认通知 · Completion Notify

> 包名 `@local/dsh-completion-notify` · 版本 1.0.0 · 已在 DSH Desktop 0.2.2-rc.1 上实测启用

会话**跑完任务**、**执行出错或中断**，或者**卡在等你授权 / 回答**时，由 DSH 主进程弹出**操作系统通知**，标题写明是哪个会话。页面被覆盖、最小化，甚至关掉，都不影响提醒；而你正盯着这个会话看时，完成类通知不会打扰。

## 为什么由主进程发通知

Electron 渲染进程里的 `Notification` 在页面被隐藏、被遮挡或窗口关闭时会直接丢失——而这恰好是最需要提醒的时刻。所以检测和发送都放在 Host：它订阅 Session 日志，再用一个隐藏的系统进程发通知；浏览器半边只负责画设置行和上报焦点。这样即使页面完全不可见，提醒依然可靠。

## 功能

### 提醒哪些时刻

| Session 事件 | 通知标题 | 正文 |
| --- | --- | --- |
| `turn/end`，`reason.kind = completed` | 「会话名」任务完成 | 回复结束，回到 DSH 查看。 |
| `turn/end`，`reason.kind = error` | 「会话名」任务出错 | 本轮执行出错，回到 DSH 查看。 |
| `turn/end`，其他原因 | 「会话名」任务中断 | 本轮结束（`<原因>`）。 |
| `approval/asked` | 「会话名」等你授权 | `<工具名>` 请求权限，回到 DSH 处理。 |
| `user-questions/request` | 「会话名」等你回答 | 有提问等你回答，回到 DSH 处理。 |

### 行为要点

- **Host 侧投递**：通知由 DSH 主进程发送，不依赖页面状态，所以页面被覆盖、切到别的应用、最小化都能收到。
- **标题带会话名**：取会话的持久标题；没有标题时退回工作目录名，再退回会话 id 后 6 位。超过 18 个字符截断并补 `…`。
- **不打扰正在看的会话**：浏览器页面持续上报「可见 / 前台 / 当前会话」，Host 只有在「页面可见 + 窗口在前台 + 正是刚结束的这个会话 + 上报不超过 90 秒」时才跳过完成 / 出错 / 中断通知。
- **授权与提问始终提醒**：这两类事件需要你操作，即使页面前台可见也会发；`user-questions/request` 只做观察，不会拦截问题本身。
- **子会话不打扰**：`origin: subagent` 的会话结束不通知。
- **一个开关 + 测试按钮**：「设置 → 通用设置」里一行，开启时行内提供「发送测试通知」。
- **串行与去重**：同一时刻只跑一个通知进程，多个会话同时结束不会起一堆 PowerShell；10 秒内相同标题只弹一次。
- **失败只降级**：通知进程报错只写日志，绝不影响对话或 Host。

## 使用

1. 打开 **设置 → 通用设置**，找到「任务完成与等待确认通知」一行；右侧开关默认开启。
2. 开关打开后，行内出现「发送测试通知」；点它立刻弹一条示例通知，用来确认系统通知通道可用。
3. 之后正常使用 DSH：切到别的窗口或把 DSH 最小化，会话结束、请求授权时会收到系统通知。
4. 通知是纯文本，带标题和正文，没有按钮；点击通知只会把 DSH 窗口带到前台。

通知长这样（示例）：

```text
「优化安装文档」任务完成
回复结束，回到 DSH 查看。
```

设置行的标题随界面语言变化：中文界面是「任务完成与等待确认通知」，英文界面是「Notify on completion and approval requests」。

## 安装

完整的安装、升级与卸载步骤见 [docs/INSTALL.md](../docs/INSTALL.md)；**每个插件单独安装**。本插件常用：

1. **方式 B：从本地文件夹安装（桌面端推荐、可离线）**：DSH Desktop 左侧栏「插件」→ 右上角「添加插件」→ 填本插件文件夹的**绝对路径**（本机为 `D:\github\dsh-plugins\dsh-completion-notify`）→「安装」→「立即启用」。
2. **方式 A：从插件索引安装**：插件页「发现」标签 →「添加索引源」→ 填 `https://raw.githubusercontent.com/stuPETER12138/dsh-plugins/main/index.json` → 找到本插件 →「安装」→「立即启用」。索引方式**需要本机能访问 GitHub**。
3. **方式 D：命令行（`dsh` CLI profile）**：`dsh plugin --profile <profile> add "link:<本插件绝对路径>"`。DSH 0.2.2 会自动把它写进该 profile 的 `dsh.profile.bundles`，重启 profile 后生效；Desktop 的 `desktop` profile 请用方式 A / B，不要从外部 CLI 改。

也可以直接让 DSH 里的 Agent 安装（方式 C），效果与方式 B 相同。

安装时必须注意：

- 路径必须是**绝对路径**，相对路径（包括 `~`）不会被接受；
- **每个插件独立安装**，插件之间没有依赖；
- 桌面端使用的是 desktop profile，请走**插件页**安装，不要手改 profile 文件。

其他插件与仓库总览见[根 README](../README.md)。

## 验证生效

- 插件页里本插件显示为已启用，没有「不可用」标记；
- 「设置 → 通用设置」能看到「任务完成与等待确认通知」一行和右侧开关；
- 点「发送测试通知」，系统右下角应出现「「示例会话」任务完成」通知（看不到就检查系统通知设置与专注助手）；
- 新建一个会话跑一轮，切到别的窗口，结束后应收到「「会话名」任务完成」。

## 兼容性

- **实测环境**：DSH Desktop 0.2.2-rc.1、Windows 11、Node 24.21.0 / pnpm 11.28.5；插件在本机已启用。
- **用到的扩展点**：Host 侧 `ctx.on('session/event')`、`ctx.on('user-questions/request')`、`ctx.webServer.register` 与 `inject = ['webServer']`；浏览器侧 `slots`（`settings.general.item`、`shell.overlay`）与 `locale`，均为 DSH 0.2.x 的公开机制。
- **平台差异**：代码按平台选择通知命令——Windows 用 `powershell.exe` + WinRT toast，macOS 用 `osascript`（带 Glass 提示音），Linux 用 `notify-send`；其他平台静默跳过。只有 Windows 11 经过实测，macOS / Linux 分支未在本仓库验证。
- **版本差异**：依赖 0.2.x 的客户端模块格式（`window.__ModuleLoader__`）与席位名，其他 DSH 版本未测试。

## 数据与隐私

- **localStorage 键**：`dsh.completion-notify.v1`，内容形如 `{"enabled":true}`，只表示开关状态；仅存在当前浏览器。
- **旧数据兼容**：旧版本的双开关形状 `{ "completes": …, "waiting": … }` 仍能读取——两项都为 `false` 才视为关闭；下一次切换开关时会改写成新形状。
- **上报内容**：只有四项——开关（`enabled`）、页面是否可见（`visible`）、窗口是否在前台（`focused`）、当前会话 id（`main`），通过查询参数发给本机 Host。
- **不联网**：只向本机 DSH Host 发同源的 `POST /completion-notify/state`（焦点 / 可见性上报）与 `POST /completion-notify/test`（测试通知），没有第三方请求，没有遥测。
- **不写文件**：不落日志文件、不建数据库，失败信息只通过 `ctx.logger` 输出。窗口焦点、可见性、当前会话 id 只存在于 Host 内存，超过 90 秒视为过期。
- **会进入系统通知中心的信息**：会话标题（或目录名 / 短 id）、工具名和固定的提示文案；它们会留在操作系统的通知历史里，请按系统设置管理。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `package.json` | bundle 声明：`dsh.bundle.patch`、`dsh.client.platform = web`、`immediately: true` 与所依赖的前端包 |
| `cordis.patch.yml` | 向 Loader 插入一行 `completion-notify` 插件行 |
| `index.js` | Host 半侧：监听 Session 事件、生成并排队通知、按平台调用系统通知，并注册两条 loopback 路由 |
| `client.js` | 浏览器半侧：设置行（开关 + 测试）、焦点与可见性上报 |
| `locale/zh.json`、`locale/en.json` | 插件管理页显示的标题与描述 |
| `icon.svg` | 插件图标 |
| `README.md` | 本文档 |

## 工作原理

1. **事件进来先过滤**：`session/event` 回调第一行比较 `event.type`，只有 `turn/end`、`approval/asked` 才继续；`origin: subagent` 的会话直接返回。
2. **算短标签**：会话标题按 session id 缓存（上限 64 条，满了清空），避免每轮都去折叠会话日志。
3. **入队**：`enqueue` 检查开关、清理过期去重记录，同一标题 10 秒内只进队一次。
4. **串行发送**：一个 drain 循环逐条执行，同一时刻只有一个通知进程。Windows 上以 `-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand` 启动 PowerShell，脚本先调用 `SetCurrentProcessExplicitAppUserModelID` 认领 `electron.app.DeepSeek Harness`，再用 WinRT 弹 toast；进程 8 秒未结束会被杀掉。
5. **浏览器上报**：`shell.overlay` 里的焦点上报组件在 `focus` / `blur` / `visibilitychange` 时立即上报，并每 30 秒心跳一次；当前会话 id 从 `useSessions` 快照里 `retainedBy.mainView > 0` 的那一项取。
6. **状态路由**：`POST /completion-notify/state?enabled=1&visible=1&focused=0&main=<id>` 用查询参数传值，Host 不做 JSON 解析；不带参数 `GET` 可回读当前状态。`POST /completion-notify/test` 会用一个临时强制开启的状态发一条示例。
7. **兜底**：Host 初始状态是「已开启 + 页面可见 + 前台」，因此浏览器尚未上报过任何状态时仍会提醒；拿不到当前会话 id 时按「没在看」处理。

## 卸载与数据清理

1. 在插件页卸载本插件（或按 [INSTALL.md](../docs/INSTALL.md) 的 CLI 方式移除 `@local/dsh-completion-notify`）。
2. 如需清除开关记录，在 DSH 开发者工具里执行：

   ```js
   localStorage.removeItem('dsh.completion-notify.v1')
   ```

3. 插件不创建任何本机文件、数据库或服务端数据，卸载后没有其他残留。

## 已知限制

- 通知由 DSH 主进程发出，**退出 DSH 后不会再提醒**。
- Windows toast 依赖已注册的 AppUserModelID（代码内固定为 `electron.app.DeepSeek Harness`）；换成其他 DSH 发行版可能需要改这个常量，本仓库不改代码。
- toast 是纯文本，没有按钮，也不能点击跳到具体会话；点击只会把 DSH 带到前台。
- 系统的专注助手 / 勿扰模式，或系统设置里关闭 DSH 通知，都会拦截横幅——这是操作系统行为。
- 10 秒去重按标题进行：两个会话短名恰好相同时，可能在窗口期内互相吞掉提醒。
- 「正在看」的判定依赖浏览器上报；页面隐藏、窗口失焦或上报超过 90 秒时按「没在看」处理，因此在你看同一会话时仍可能收到完成通知。
- 授权 / 提问通知不受「正在看」抑制，这是有意的设计：它们需要你操作。
- macOS 固定使用 Glass 提示音；Linux 的 `notify-send` 是否显示取决于桌面环境。

## 许可证

MIT License。可自由使用、修改与分发，请保留版权声明；插件按「现状」提供，不附带任何明示或暗示的担保。完整文本见仓库根目录的 [LICENSE](../LICENSE)。
