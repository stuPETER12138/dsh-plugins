# 兼容性

本仓库插件围绕 **DeepSeek Harness Desktop 0.2.2-rc.1** 开发与验证。DSH 仍处于快速迭代期，插件用到的服务、插槽与浏览器模块系统在不同版本间可能变化，因此升级 DSH 后建议重新跑一遍验证。

## 验证矩阵

| 插件 | 版本 | DSH Desktop 0.2.2-rc.1 / Windows 11 | 类型 |
| --- | --- | --- | --- |
| `dsh-completion-notify` | 1.0.0 | ✅ 通过 | Host + 浏览器 |
| `dsh-session-share` | 0.2.0 | ✅ 通过 | Host + 浏览器 |
| `dsh-sticky-wall` | 1.2.0 | ✅ 通过 | 纯浏览器 |
| `dsh-style-studio` | 1.3.0 | ✅ 通过 | 纯浏览器 |
| `dsh-usage-stats` | 1.1.0 | ✅ 通过 | Host + 浏览器 |

- 验证方式：在**隔离的临时 `DSH_HOME` + 临时 profile** 中，用 DSH 自带运行时（`resources/runtime/cli/bin/dsh.cmd`，`0.2.2-rc.1`）逐个安装 5 个插件，检查依赖安装、组合包选择、`--dump-config` 组合结果、Host 半加载、Web 服务启动以及各插件 client bundle 是否由 `/plugins` 路由提供。记录见 [VERIFICATION.md](VERIFICATION.md)。
- `dsh-session-share` 0.2.0 新增 LaTeX 公式渲染：该版本通过 4 个单元测试套件（176 项断言）与无头 Chromium 端到端导出验证（PNG/PDF、基线对齐、跨页不拆行、无 MathML 时回退原文）；隔离 profile 的安装/加载全链路沿用 `VERIFICATION.md` 中 0.1.0 的记录（Host 半与插件清单未变，浏览器半为新增）。
- `dsh-sticky-wall` 1.2.0 把便签墙从等高网格改成按最短列落位的瀑布流：在隔离 profile 中安装后由无头 Edge 做交互与几何断言（列宽 / 14px 间距 / 同列紧贴 / 无重叠 / 墙高 / 缩放重排 / 新增与编辑时的重排），并与 1.1.0 的网格布局做对照；记录见 `VERIFICATION.md` 的增量记录。运行位置与插槽未变，仍是纯浏览器插件。
- `dsh-usage-stats` 1.1.0 新增「供应商用量」卡片（按供应商拆解模型与会话消耗）：在隔离 profile 中用真实会话数据的只读副本，完成载荷 v4（`sessions[].modelUsage`）在 7 天 / 30 天 / 全部时间三个范围的不变量校验与无头 Edge 面板交互端到端验证（71/71 断言，含供应商切换、会话展开、存量卡片回归），记录见 `VERIFICATION.md` 的增量记录；Host 未新增路由，安装/加载链路沿用 1.0.0 的记录。
- 组合包没有声明 `engines.dsh` 版本门槛（避免预发布版本范围把用户挡在门外），因此安装前请**自行确认 DSH 版本**；低于 `0.2.2-rc.1` 的版本大概率缺少下面列出的 API。

## 运行时环境

| 项目 | 值 |
| --- | --- |
| DSH 形态 | Desktop（Electron），profile `desktop` |
| DSH 版本 | `0.2.2-rc.1` |
| 内嵌 Node | `24.21.0` |
| 内嵌 pnpm | `11.28.5` |
| 操作系统 | Windows 11（x64） |
| 浏览器内核 | DSH Desktop 内嵌 Chromium |

## 插件依赖的 DSH 能力

各插件只使用 DSH 的公开 Service / 插槽。若未来版本重命名或改签名，对应插件需要适配。

| 插件 | 依赖的 DSH 能力 |
| --- | --- |
| `dsh-completion-notify` | `session/event` 会话事件（`turn/end`、`approval/asked`）、`user-questions/request` 观察、Host→浏览器循环路由、`settings.general.item` 插槽、`dsh-client-locale`；系统通知命令（Windows PowerShell / macOS `osascript` / Linux `notify-send`） |
| `dsh-session-share` | `sessionQuery.readSession()`、`sessionPersistence`、`attachments.readImage()`、仅回环可访问的只读 HTTP 路由、`conversation.view` 插槽、`dsh-client-locale`；浏览器 Canvas / PDF 手写生成（无第三方库）；LaTeX 公式依赖浏览器 **MathML Core**（Chromium 109+）与系统数学字体（Windows 为 Cambria Math） |
| `dsh-sticky-wall` | 纯浏览器：`sidebar.panellist` 与 `main` 插槽、`localStorage`、`--dsw-*` 主题 token |
| `dsh-style-studio` | 纯浏览器：`ctx.theme.overrideTokens()`、`settings.general.item` 插槽、`dsh-client-ui-theme`、`dsh-client-locale` |
| `dsh-usage-stats` | `sessionPersistence.list()/open()`、`sessionQuery.readSession()`、内存 `sessions` 服务、仅回环可访问的 HTTP 路由、`sidebar.panellist` 与 `main` 插槽、`dsh-client-locale` |

## 平台说明

- **Windows 11**：全部功能已实测。
- **macOS / Linux**：代码里为系统通知准备了 `osascript` / `notify-send` 分支，`dsh-style-studio` 也处理了 macOS 侧栏固定的渐变着色问题，但**没有在真实 macOS/Linux 上跑过**。DSH Desktop 本身的多平台行为也可能不同，使用前请自行验证。
- **外部浏览器（`dsh web`）**：理论上可用（插件只依赖 Web 平台），但字体度量、Canvas 渲染与下载行为可能与内嵌 Chromium 有差异，未做实测。
- **字体**：`dsh-style-studio` 的「水墨书画」风格优先使用 LXGW WenKai（霞鹜文楷），未安装时回退到宋体/衬线字体，不影响使用；`dsh-session-share` 的公式排版使用系统数学字体（Windows 为 Cambria Math），缺失时由 Chromium 回退到其他数学字体，公式仍会显示。
- **无头/外部浏览器**：公式渲染依赖 Chromium 的 MathML Core（Chrome 109+）；更旧的浏览器会自动回退为显示原始 TeX，导出不会失败。

## 插件市场索引兼容性

- 仓库根目录 `index.json` 使用 **Plugin market index format 1**，由 DSH 0.2.x 的 `@deepseek-ai/dsh-plugin-market-index` 校验。索引声明的每个版本都是 Git 来源：固定 40 位 commit + `path`（仓库子目录）。
- 该格式对应 DSH 的「自定义插件索引 / 发现」功能；需要 DSH 启用对应的实验性组合包，且能访问 GitHub。
- 索引中的版本号、发布时间等展示信息由仓库脚本生成；实际安装内容以固定 commit 的文件为准。

## 升级 DSH 之后

1. 先看本页与 [VERIFICATION.md](VERIFICATION.md) 是否已更新到新版本。
2. 在插件页确认 5 个插件的行状态均为运行中；若有异常，打开详情看 Host 给出的原因。
3. 如果 DSH 更新了浏览器模块系统或插槽 API，需要按 [DEVELOPMENT.md](DEVELOPMENT.md) 升级插件代码，然后重新生成 `index.json` 并发布。
4. 升级后如遇崩溃或界面异常，先在插件页禁用可疑插件，再定位问题。
