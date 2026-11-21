# dsh-plugins

一组自研的 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) Web 插件，在本机 DSH Desktop 上日常使用。每个插件都是独立的文件夹、独立的 npm 包（`@local/dsh-*`），可以单独安装、单独卸载。

**当前适配版本：DSH Desktop `0.2.2-rc.5`**（Windows 11 实测；各插件 README 注明自己的实测版本）。所有插件均为纯 ESM，无第三方 npm 依赖、无需构建步骤。

## 插件一览

| 插件 | 包名 / 版本 | 功能 | 在 DSH 里从哪里用 |
| --- | --- | --- | --- |
| [dsh-completion-notify](dsh-completion-notify/README.md) | `@local/dsh-completion-notify` · 1.0.0 | 会话跑完任务、出错、中断，或卡在等你授权/回答时，由 DSH 主进程弹出**操作系统通知**，标题写明是哪个会话 | 设置 → 通用 → 通知开关（+ 测试按钮） |
| [dsh-session-share](dsh-session-share/README.md) | `@local/dsh-session-share` · 0.2.1 | 挑选当前会话里要分享的消息，导出为 **Markdown / PNG 长图 / PDF**，图片、表格与 **LaTeX 公式**都会排版，全部在本机完成 | 会话标题下方的「分享」页签 |
| [dsh-sticky-wall](dsh-sticky-wall/README.md) | `@local/dsh-sticky-wall` · 1.4.4 | 左侧栏的**便签墙**：随手记灵感、置顶、搜索、六种便签纸颜色，支持撤销删除；长短不一的便签按最短列**交错紧密排列**（瀑布流）。还能选中会话文字**收藏为书签**，按会话索引、搜索、复制与删除，**点书签跳回原文字**，会话归档后书签自动消失 | 左侧栏「便签墙」+ 会话选中文字浮条 |
| [dsh-gamepad-voice](dsh-gamepad-voice/README.md) | `@local/dsh-gamepad-voice` · 1.1.0 | 左侧栏的**手柄与语音**面板：按 Xbox One 键位标注每个动作（A/B/X/Y、LB/RB、View/Menu、十字键），连接手柄时左下角显示按键提示条；按住 Y 说话，由本机 SenseVoice 转写并插入当前草稿 | 左侧栏「手柄与语音」+ 全局手柄 |
| [dsh-usage-stats](dsh-usage-stats/README.md) | `@local/dsh-usage-stats` · 3.0.0 | **用量与资源**面板：本机会话日志算出的 Token 用量与估算成本、一格一天的日历热力图、DSH 的 CPU / 内存 / 磁盘占用，以及「已归档 + 90 天未写」旧会话的**可回收空间清单**（预览 → 勾选 → 二次确认才删除） | 左侧栏「用量与资源」 |
| [dsh-agent-memory](dsh-agent-memory/README.md) | `@local/dsh-agent-memory` · 2.0.0 | 左侧栏的**长期记忆**库：常驻画像 + 一条一条的记录（按 `kind` 语义/情节/过程 × `subject` 我/机器/项目 标注）。**默认零注入**，在对话里 `/memory <要回忆的内容>` 才把相关记录作为上下文送达；相似记录进「待确认」，合并与否由你决定 | 左侧栏「记忆」 + `/memory` 命令 |

## 安装

三种方式任选其一，**每个插件单独安装**。完整步骤、卸载与常见问题见 [docs/INSTALL.md](docs/INSTALL.md)。

### 方式 A：从插件索引安装（DSH 插件页「发现」标签）

前提：插件页有 **发现 / Discover** 标签（即启用了 DSH 的可选插件「自定义插件索引」），且本机能访问 GitHub。

1. 打开 **插件** 页 → **发现** 标签 → **添加索引源**。
2. 填入本仓库的索引地址（任选其一）：

   ```text
   https://raw.githubusercontent.com/stuPETER12138/dsh-plugins/main/index.json
   ```

   如果 `raw.githubusercontent.com` 在你的网络下不可达，可用 jsDelivr 的 GitHub 镜像之一（内容相同，可能有几小时 CDN 缓存）：

   ```text
   https://cdn.jsdelivr.net/gh/stuPETER12138/dsh-plugins@main/index.json
   https://fastly.jsdelivr.net/gh/stuPETER12138/dsh-plugins@main/index.json
   https://gcore.jsdelivr.net/gh/stuPETER12138/dsh-plugins@main/index.json
   ```

3. 在列表里找到插件 → **安装** → **立即启用**。

索引里的每个版本都固定在 GitHub 的具体 commit 上，从仓库对应子目录安装，不需要手动 clone。

### 方式 B：从本地文件夹安装（离线、最稳）

1. 获取仓库：

   ```powershell
   git clone https://github.com/stuPETER12138/dsh-plugins.git D:\github\dsh-plugins
   ```

   也可以直接下载 ZIP 解压。
2. 打开 DSH Desktop → 左侧栏 **插件** → 右上角 **添加插件**。
3. 填入**某个插件文件夹的绝对路径**，例如：

   ```text
   D:\github\dsh-plugins\dsh-sticky-wall
   ```

4. Host 读出包名/版本/简介后点 **安装**，完成后再点 **立即启用**（或之后在「已安装插件」里打开开关）。
5. 其他插件重复第 3–4 步即可。一般即时生效；若界面没变化，刷新页面或重启 DSH Desktop。

> 路径必须是**绝对路径**（可以是 `link:` 前缀），相对路径会被插件管理器拒绝。

### 方式 C：让 DSH 里的 Agent 安装

在 DSH 对话里直接说：

> 把 `D:\github\dsh-plugins\dsh-usage-stats` 安装到当前 profile 并启用。

Agent 会调用插件管理器完成同样的「安装 + 启用」流程（需要 danger-full-access 或一次审批）。

### 方式 D：命令行（适用于 `dsh` CLI profile）

```powershell
dsh plugin --profile <profile> add "link:D:\github\dsh-plugins\dsh-sticky-wall"
```

DSH `0.2.2` 的这条命令会在安装依赖后**自动把组合包加入 profile 的 `dsh.profile.bundles`**；重启该 profile 生效。Desktop 的 `desktop` profile 建议用方式 A/B，由桌面端自己管理依赖。

## 兼容性与验证

- 测试环境：**DSH Desktop 0.2.2-rc.1**，Windows 11，Node `24.21.0`，pnpm `11.28.5`。
- 每个插件都在隔离的临时 profile 中用 DSH 自己的运行时完成过「安装 → 组合 → 启动 → 客户端 bundle 提供」全链路验证，详见 [docs/VERIFICATION.md](docs/VERIFICATION.md)。
- 更低版本的 DSH 缺少部分 API（如 `settings.general.item`、`conversation.view` 等插槽），未做兼容，可能无法加载；升级 DSH 后建议先看 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)。
- 全部插件不依赖第三方 npm 包，也不需要编译；没有 `node_modules`。

## 安全与隐私

- 不收集遥测，不上传会话内容。
- `dsh-usage-stats` 只读取本机 `$DSH_HOME/sessions` 下的会话日志，只在 `$DSH_HOME/cache/dsh-usage-stats/` 写一份统计缓存；它唯一会写会话目录的操作，是你在「可回收空间」里勾选并二次确认后删除已归档的旧日志（删除前 Host 会重新校验归档状态与 90 天窗口）。
- `dsh-session-share` 的导出完全在浏览器本机完成；Host 只提供一个仅回环可访问的只读会话接口。
- `dsh-completion-notify` 只调用本机系统通知命令（Windows PowerShell / macOS `osascript` / Linux `notify-send`）。
- `dsh-sticky-wall` 是纯前端插件，数据存在浏览器 `localStorage`。
- `dsh-gamepad-voice` 是纯前端插件，设置存在浏览器 `localStorage`；录音只交给本机「语音输入」插件转写，不上传、不落盘。
- `dsh-agent-memory` 把画像与记录存成 `$DSH_HOME/agent-memory/` 下的 `core.md` 与 `records.jsonl`，只在本机读写；只有你敲 `/memory` 时，检索结果才会进入那一次请求，其余时间不占上下文。
- 插件页/索引安装时，pnpm 会访问 npm 源；索引安装还会访问 GitHub。这是 DSH 安装插件的正常网络行为。

## 仓库结构

```text
dsh-plugins/
├─ dsh-completion-notify/   # 每个插件：独立的 package.json + cordis.patch.yml + 源码 + README
├─ dsh-session-share/
├─ dsh-sticky-wall/
├─ dsh-gamepad-voice/
├─ dsh-usage-stats/
├─ dsh-agent-memory/
├─ index.json               # DSH 插件市场索引（format 1），供「发现」标签使用
├─ docs/
│  ├─ INSTALL.md            # 安装 / 升级 / 卸载 / 排错
│  ├─ COMPATIBILITY.md      # 兼容性矩阵与版本说明
│  ├─ DEVELOPMENT.md        # 插件结构、开发、构建与发布流程
│  ├─ DESIGN.md             # 各插件共用的视觉规则与 kill-ai-slop 复查记录
│  └─ VERIFICATION.md       # 在 DSH 0.2.2-rc.1 / rc.5 上的实测记录
├─ scripts/
│  ├─ generate-index.mjs    # 重新生成 index.json
│  ├─ storage-audit.mjs     # 离线预览用量插件的可回收空间清单（dry run）
│  ├─ verify-repo.mjs       # 仓库静态校验
│  └─ verify-install.ps1    # 隔离 profile 安装/启动验证
├─ LICENSE                  # MIT
└─ README.md
```

## 开发

想改代码或新增插件：见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)；界面规则（颜色、字号、圆角、动效与文案）见 [docs/DESIGN.md](docs/DESIGN.md)。提交前跑一遍：

```powershell
node scripts/verify-repo.mjs
node scripts/generate-index.mjs   # 需要提交后重新生成索引
```

## English

Six personal [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web plugins, each an independent package (`@local/dsh-*`), verified on **DSH Desktop 0.2.2-rc.1 / rc.5** (each plugin's README states the version it was tested on).

| Plugin | What it does |
| --- | --- |
| `dsh-completion-notify` | OS notifications (task finished / errored / waiting for approval or answer) sent by the DSH host, titled with the session. |
| `dsh-session-share` | Pick messages from the current conversation and export Markdown, a PNG image, or a PDF — tables, images and LaTeX formulas are laid out on-device. |
| `dsh-sticky-wall` | A sticky-note wall in the left sidebar: capture, pin, search, undo delete; notes of any height tile tightly in staggered columns. Selected conversation text can be bookmarked into a per-session index — searchable, copyable, and a bookmark jumps back to its text; bookmarks disappear when the session is archived. |
| `dsh-gamepad-voice` | **Gamepad & voice** in the left sidebar: every action labelled with its Xbox One button (A/B/X/Y, LB/RB, View/Menu, D-pad), a button hint strip while a controller is connected, and hold-Y speech transcribed locally by SenseVoice into the current draft. |
| `dsh-usage-stats` | **Usage & Resources** in the left sidebar: token usage and estimated cost with a calendar heatmap, DSH's CPU / memory / disk footprint, and a reclaimable-space list of archived sessions untouched for 90 days — preview, select, confirm, then delete. |
| `dsh-agent-memory` | **Long-term memory** in the left sidebar: a standing profile plus tagged records. Nothing is injected by default — `/memory <query>` recalls the relevant ones into the next request; near-duplicates wait for your merge decision. |

**Install (offline):** clone this repo, open **Plugins → Add plugin** in DSH Desktop, and paste the absolute path of one plugin folder (for example `D:\github\dsh-plugins\dsh-sticky-wall`). Install and enable it, then repeat for the others.

**Install (plugin index):** if your Plugins page has a **Discover** tab, add this index URL and install from the list:

```text
https://raw.githubusercontent.com/stuPETER12138/dsh-plugins/main/index.json
```

More: [docs/INSTALL.md](docs/INSTALL.md) · [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) · [docs/VERIFICATION.md](docs/VERIFICATION.md)

## License

[MIT](LICENSE)
