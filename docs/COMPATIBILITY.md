# 兼容性

本仓库插件围绕 **DeepSeek Harness Desktop 0.2.2** 开发：2026-11-07 的首次全链路验证在 `0.2.2-rc.1` 上完成，之后的插件与增量在 `0.2.2-rc.5` 上验证（`dsh-usage-stats` 3.0.0 的记录没有写版本号）。DSH 仍处于快速迭代期，插件用到的服务、插槽与浏览器模块系统在不同版本间可能变化，因此升级 DSH 后建议重新跑一遍验证。

## 验证矩阵

下表对应当前仓库里的 3 个插件与它们的当前版本；每一项的详细记录见 [VERIFICATION.md](VERIFICATION.md)。

| 插件 | 版本 | 类型 | 实测 DSH | 结论 |
| --- | --- | --- | --- | --- |
| `dsh-completion-notify` | 1.0.0 | Host + 浏览器 | `0.2.2-rc.1` | ✅ 全链路通过；系统通知的真实弹出未端到端 |
| `dsh-sticky-wall` | 1.4.4 | 纯浏览器 | `0.2.2-rc.1`、`0.2.2-rc.5` | ✅ 1.2.0 增量 + 1.4.4 多轮本机 e2e；文字记录只到 1.2.0 |
| `dsh-usage-stats` | 3.0.0 | Host + 浏览器 | `0.2.2-rc.1`（3.0.0 记录未写版本） | ✅ 3.0.0 增量通过（29 断言 + 7 个 Host 测试） |

- 验证方式：在**隔离的临时 `DSH_HOME` + 临时 profile** 中，用 DSH 自带运行时（`resources/runtime/cli/bin/dsh.cmd`）逐个安装插件，检查依赖安装、组合包选择、`--dump-config` 组合结果、Host 半加载、Web 服务启动以及各插件 client bundle 是否由 `/plugins` 路由提供；需要界面的功能再用无头 Chrome / Edge 通过 CDP 断言真实 DOM。
- `dsh-completion-notify` 1.0.0 是 `0.2.2-rc.1` 全链路验证的一部分（安装、组合、Host 加载、bundle 提供均通过）。系统通知本身需要真实会话的完成 / 等待授权事件，隔离 profile 没有模型凭据，因此**弹窗行为未端到端验证**，只验证了事件注册与调用路径。
- `dsh-sticky-wall` 1.2.0 把便签墙从等高网格改成按最短列落位的瀑布流：在隔离 profile 中由无头 Edge 做交互与几何断言（列宽 / 14px 间距 / 同列紧贴 / 无重叠 / 墙高 / 缩放重排 / 新增与编辑时的重排），并与 1.1.0 的网格布局对照，记录见 `VERIFICATION.md` 的增量记录。1.3.x / 1.4.x 新增**会话书签**（选中文字收藏、按会话索引、跳回原文字、归档清理）：瀑布流回归在 1.4.4 的代码上跑过 45/45 断言，书签与跳转用 `tmp/` 下的一次性 e2e 脚本在本机反复验证，证据在 `.verify-sticky-wall/`（两者都被 `.gitignore` 覆盖，未提交）；**这一段还没有写进 `VERIFICATION.md` 的文字记录**。
- `dsh-usage-stats` 2.0.0 → 2.3.0 逐版有增量记录（面板重写、日历热力图、范围默认值、模型用量口径），均带隔离实例的断言数；3.0.0 扩成「用量与资源」后，在隔离 profile 中用真实会话日志的只读副本验证了载荷三段（`resources` / `storage` / `cleanup`）、dry-run 路由与删除闸门（未确认 / 近期 / 未知 / 运行中一律拒绝，合法确认只删符合条件的目录），29/29 断言通过，另有 7 个 Host 隔离测试（`node --test dsh-usage-stats/test/host.test.mjs`）。唯一会写会话目录的路径是清理，且删除前 Host 会重新扫描复核。
- 组合包没有声明 `engines.dsh` 版本门槛（避免预发布版本范围把用户挡在门外），因此安装前请**自行确认 DSH 版本**；低于 `0.2.2-rc.1` 的版本大概率缺少下面列出的 API。

## 运行时环境

| 项目 | 值 |
| --- | --- |
| DSH 形态 | Desktop（Electron），profile `desktop` |
| DSH 版本 | `0.2.2-rc.1`（2026-11-07 全链路）、`0.2.2-rc.5`（2026-11-17 之后的插件与增量，Electron 44） |
| 内嵌 Node | `24.21.0` |
| 内嵌 pnpm | `11.28.5` |
| 操作系统 | Windows 11（x64） |
| 浏览器内核 | DSH Desktop 内嵌 Chromium（`rc.5` 为 Electron 44） |

## 插件依赖的 DSH 能力

各插件只使用 DSH 的公开 Service / 插槽。若未来版本重命名或改签名，对应插件需要适配。

| 插件 | 依赖的 DSH 能力 |
| --- | --- |
| `dsh-completion-notify` | `session/event` 会话事件（`turn/end`、`approval/asked`）、`user-questions/request` 观察、Host→浏览器循环路由、`settings.general.item` 插槽、`dsh-client-locale`；系统通知命令（Windows PowerShell / macOS `osascript` / Linux `notify-send`） |
| `dsh-sticky-wall` | 纯浏览器：`sidebar.panellist`、`main` 与 `conversation.chat.text-interaction` 插槽、`sessions` / `workspaces` / `uiWorkspace` / `uiConversation` 客户端服务、`localStorage`、`--dsw-*` 主题 token |
| `dsh-usage-stats` | Host：`webServer`（仅回环路由）、`sessions`、`sessionPersistence.list()/open()`（旧格式日志回退 `sessionQuery.readSession()`）、`workspaceRegistry.archivedSessionIds`（缺失时没有可回收会话）、Node `process` / `os`，Windows 上另用 `tasklist` 取整应用内存；浏览器：`sidebar.panellist`、`main` 与 `dsh-client-locale` |

## 平台说明

- **Windows 11**：全部功能已在本机实测。
- **macOS / Linux**：代码里为系统通知准备了 `osascript` / `notify-send` 分支，但**没有在真实 macOS/Linux 上跑过**。DSH Desktop 本身的多平台行为也可能不同，使用前请自行验证。
- **外部浏览器（`dsh web`）**：插件只依赖 Web 平台，理论上可用。但 `tasklist` 的内存口径只在 Windows 成立（其它平台退化为 Host 进程数字），字体度量与渲染也可能与内嵌 Chromium 有差异，未做实测。

## 插件市场索引兼容性

- 仓库根目录 `index.json` 使用 **Plugin market index format 1**，由 DSH 0.2.x 的 `@deepseek-ai/dsh-plugin-market-index` 校验。索引声明的每个版本都是 Git 来源：固定 40 位 commit + `path`（仓库子目录）。
- 该格式对应 DSH 的「自定义插件索引 / 发现」功能；需要 DSH 启用对应的实验性组合包，且能访问 GitHub。
- 索引中的版本号、发布时间等展示信息由仓库脚本生成；实际安装内容以固定 commit 的文件为准。

## 升级 DSH 之后

1. 先看本页与 [VERIFICATION.md](VERIFICATION.md) 是否已更新到新版本。
2. 在插件页确认各插件的行状态均为运行中；若有异常，打开详情看 Host 给出的原因。
3. 如果 DSH 更新了浏览器模块系统或插槽 API，需要按 [DEVELOPMENT.md](DEVELOPMENT.md) 升级插件代码，然后重新生成 `index.json` 并发布。
4. 升级后如遇崩溃或界面异常，先在插件页禁用可疑插件，再定位问题。
