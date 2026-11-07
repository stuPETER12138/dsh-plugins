# 安装、升级与卸载

本仓库的 5 个插件都是独立的 DSH「组合包（bundle）」，每个插件单独安装、单独启用、单独卸载。本文以当前验证过的环境为准：

| 项目 | 值 |
| --- | --- |
| DSH | DeepSeek Harness **Desktop 0.2.2-rc.1** |
| 系统 | Windows 11（实测） |
| 运行时 | Node `24.21.0`，pnpm `11.28.5`（Desktop 自带） |
| 插件依赖 | 无第三方 npm 依赖、无需构建 |

> 插件在 DSH 的 Host 进程内以本机代码运行，权限与你当前用户相同。只安装你信任来源的插件。

## 先选一种安装方式

| 方式 | 适合谁 | 需要网络 | 是否自动启用 |
| --- | --- | --- | --- |
| A. 插件页「发现」/ 插件索引 | 已启用「自定义插件索引」且能访问 GitHub | 需要 GitHub + npm 源 | 是（点「立即启用」） |
| B. 插件页本地路径 | 所有人；离线、最稳 | 首次打开插件页时 DSH 可能询问 npm 源，仅安装本地链接不需要下载 | 是（点「立即启用」） |
| C. 在对话里让 Agent 安装 | 想一句话搞定 | 同方式 B | 是 |
| D. `dsh` 命令行 | 使用 `dsh` CLI 的 profile（web / tui / 自定义） | 仅本地链接时不需要 | 自动加入组合包，需重启 profile |

Desktop 的 `desktop` profile 由桌面端自己管理依赖，**推荐用方式 A 或 B**。

---

## 方式 A：从插件索引安装（推荐，有「发现」标签时）

DSH 的**插件索引**是一份 JSON 清单，列出可安装的组合包及其来源。本仓库根目录的 [`index.json`](../index.json) 就是格式 1 的索引（每个版本固定到 GitHub 的具体 commit）。

**前提**

1. 插件页存在「**发现**」标签。没有的话，说明当前 DSH 没有启用可选的「自定义插件索引」：打开 **插件 → 实验性插件**，启用「**自定义插件索引**」（英文界面为 *Custom plugin indexes*），即会出现「发现」标签。
2. 本机能访问 GitHub（索引里的插件版本以 `git+https://github.com/...` 形式安装）。若 GitHub 不可达，改用方式 B。

**步骤**

1. 打开 DSH Desktop → 左侧栏 **插件** → **发现** 标签。
2. 点 **添加索引源**，填入本仓库的索引地址（任选其一）：

   ```text
   https://raw.githubusercontent.com/stuPETER12138/dsh-plugins/main/index.json
   ```

   如果 `raw.githubusercontent.com` 在你的网络下不可达，用 jsDelivr 的 GitHub 镜像之一（内容相同，可能有几小时 CDN 缓存；索引里的版本仍固定到具体 commit）：

   ```text
   https://cdn.jsdelivr.net/gh/stuPETER12138/dsh-plugins@main/index.json
   https://fastly.jsdelivr.net/gh/stuPETER12138/dsh-plugins@main/index.json
   https://gcore.jsdelivr.net/gh/stuPETER12138/dsh-plugins@main/index.json
   ```

3. 等待索引读取完成，在列表中找到插件，打开条目后可看到默认版本、来源（Git 仓库 + 固定 commit + 目录）和「安装」按钮。
4. 点 **安装** → 确认 → 等安装完成 → **立即启用**。
5. 其他插件同样操作即可。

**说明与限制**

- 索引只负责找到插件；真正的安装在 `pluginManager.installBundle` 里完成，pnpm 会从 GitHub 拉取该 commit 下的对应子目录。
- DSH 的插件市场**不支持原地升级**：索引里出现更新版本时只会标记「有新版本」，需要先卸载旧版、再安装新版。
- 索引内容没有签名；实际安装的包以 GitHub 上固定 commit 的内容为准。请确认仓库来源可信。

---

## 方式 B：从本地文件夹安装（离线、最稳）

**步骤**

1. 把仓库放到本机，任选一种：
   - `git clone https://github.com/stuPETER12138/dsh-plugins.git D:\github\dsh-plugins`
   - 或在 GitHub 页面点 **Code → Download ZIP** 后解压（例如解压到 `D:\github\dsh-plugins`）。
2. 记下要安装的插件文件夹**绝对路径**，例如：

   ```text
   D:\github\dsh-plugins\dsh-completion-notify
   D:\github\dsh-plugins\dsh-session-share
   D:\github\dsh-plugins\dsh-sticky-wall
   D:\github\dsh-plugins\dsh-style-studio
   D:\github\dsh-plugins\dsh-usage-stats
   ```

3. 打开 DSH Desktop → 左侧栏 **插件** → 右上角 **添加插件**。
4. 在输入框粘贴**插件文件夹本身**的绝对路径（例如 `D:\github\dsh-plugins\dsh-sticky-wall`），点 **安装**。
   - 也接受 `link:` 前缀：`link:D:\github\dsh-plugins\dsh-sticky-wall`。
   - 必须是绝对路径；相对路径会被拒绝。
   - 要填插件目录，不能填仓库根目录。
5. Host 会读出包名、版本和简介；确认后安装。完成后点 **立即启用**，或在「已安装插件」列表里打开它的开关。
6. 其余插件重复第 4–5 步。

**生效时间**

- 新安装的组合包通常立即挂载；若界面没有出现新入口，**刷新页面**一次。
- 替换已安装版本的代码、或修改插件的 Host 半（`index.js`）后，需要**重启 DSH Desktop** 才能加载新的 JavaScript 模块代际。
- 插件页与设置列表来自 Host 的实时清单，一般无需重启即可看到开关状态。

---

## 方式 C：让 DSH 里的 Agent 安装

在 DSH 对话中直接说：

> 把 `D:\github\dsh-plugins\dsh-usage-stats` 安装到当前 profile 并启用。

Agent 会调用 `plugin_manager` 的安装操作，效果与方式 B 相同（安装依赖并选中组合包）。该工具在当前会话权限为 danger-full-access、或你批准了那一次调用时可用。

---

## 方式 D：命令行（`dsh` CLI profile）

适用于用 `dsh` 命令启动的 profile（`web`、`tui`、`acp` 或你自己 `--from-default-profile` 创建的 profile），例如：

```powershell
dsh plugin --profile myprofile add "link:D:\github\dsh-plugins\dsh-sticky-wall"
```

- DSH `0.2.2` 的 `dsh plugin` 会在 pnpm 安装成功后，**自动把组合包加入该 profile `package.json` 的 `dsh.profile.bundles`**。
- 装完后重启该 profile（重新执行 `dsh --profile myprofile ...`）才会加载。
- 如果安装的是 Git spec（形如 `git+https://...#<commit>&path:/<dir>`，即插件索引生成的地址），在 Windows 的 `cmd.exe` 下必须把整个 spec 用**单引号再包一层**，否则 `&` 会被命令解释器截断；从插件页 / 索引安装时由 Host 直接调用 pnpm，不存在这个问题。
- 如果目标是 Desktop 的 `desktop` profile：不要从外部 CLI 改它，使用方式 A/B，让桌面端自己管理依赖与锁。
- CLI 需要 PATH 上有 pnpm（Desktop 自带运行时 pnpm 在 `resources/runtime/primary-runtime/dependencies/pnpm`；用 DSH 自带 CLI 时也可用 `resources/runtime/cli/bin/dsh.cmd`）。

---

## 安装后怎么确认成功

1. **插件页 → 已安装插件**：能看到对应组合包卡片，行状态为运行中（开关为开）。若显示异常，卡片/详情页会给出原因。
2. **对应入口出现**：
   - `dsh-completion-notify`：设置 → 通用 → 通知行。
   - `dsh-session-share`：任意会话标题下方的「分享」页签。
   - `dsh-sticky-wall`：左侧栏「便签墙」。
   - `dsh-style-studio`：设置 → 通用 → 「视觉风格」行。
   - `dsh-usage-stats`：左侧栏「用量统计」。
3. 功能本身正常使用（每个插件的 README 有「验证生效」小节）。

仓库里还有一份隔离环境的自动化验证记录：[docs/VERIFICATION.md](VERIFICATION.md)。

---

## 升级

| 安装方式 | 升级做法 |
| --- | --- |
| 本地文件夹 | `git pull`（或替换文件）后重启 DSH Desktop；若插件页对同名包报 `already-installed`，先在插件页卸载，再重新安装并启用。 |
| 插件索引 | 发现 → 打开条目 → 卸载旧版（已安装页）→ 安装新版 → 立即启用。市场不提供原地升级。 |
| CLI profile | 先 `dsh plugin --profile <profile> remove <包名>`（或手动从 `dsh.profile.bundles` 移除），再加新路径；重启 profile。 |

升级前建议看一下 [docs/COMPATIBILITY.md](COMPATIBILITY.md) 与每个插件的已知限制；宿主 API 在 DSH 大版本间可能变化。

---

## 卸载

**桌面端（推荐）**：插件页 → 已安装插件 → 打开该插件 → **卸载**。卸载只移除依赖和组合包选择，不会删除插件产生的用户数据。

**CLI profile**：先关闭组合包 / 从 profile `package.json` 的 `dsh.profile.bundles` 移除包名，再执行：

```powershell
dsh plugin --profile <profile> remove @local/dsh-xxx
```

重启 profile。如残留文件，可手动删除 profile 的 `node_modules` 对应目录。

### 卸载后的数据清理（可选）

| 插件 | 数据位置 |
| --- | --- |
| `dsh-completion-notify` | 浏览器 `localStorage` 键 `dsh.completion-notify.v1`（通知开关 `enabled`；「发送测试通知」不落盘） |
| `dsh-session-share` | 浏览器 `localStorage` 键 `dsh.session-share.prefs.v1`（导出偏好） |
| `dsh-sticky-wall` | 浏览器 `localStorage` 键 `dsh.sticky-wall.notes.v1`（全部便签）与 `dsh.sticky-wall.prefs.v1`（上次选择的纸色） |
| `dsh-style-studio` | 浏览器 `localStorage` 键 `dsh.style-studio.v1`（所选风格） |
| `dsh-usage-stats` | 缓存文件 `$DSH_HOME/cache/dsh-usage-stats/summaries.v5.json`；插件配置在 profile 的 `cordis.patch.yml` 里 `usage-stats` 行 |

浏览器数据可在 DSH 页面用开发者工具清除对应 key；缓存目录直接删除即可（下次打开面板会重建）。

---

## 常见问题

**Q1：插件页没有「发现」标签。**
说明没有启用「自定义插件索引」可选插件。到插件页的「实验性插件」里启用它；或直接用方式 B。

**Q2：添加插件时报 `not-a-bundle` / `not-a-package`。**
大多数是路径填错：要填**某个插件文件夹本身**（里面直接有 `package.json`），不是仓库根目录，也不是压缩包文件。

**Q3：报「local path must be absolute」/找不到路径。**
请使用 Windows 绝对路径（如 `D:\github\dsh-plugins\dsh-usage-stats`），或以 `link:` 开头的绝对路径；不要用 `.`、`..`、`~`、环境变量。

**Q4：安装时无法访问 GitHub / 一直超时。**
方式 A 依赖 GitHub 可达（插件版本固定在 GitHub commit 上）。改用方式 B 的本地文件夹安装即可完全离线，无需任何 GitHub 连接。
如果你仍想用方式 A，但本机只有 GitHub SSH 可用、HTTPS 被阻断，可以临时让 Git 把 HTTPS 地址重写为 SSH（要求本机已把 SSH key 加到 GitHub 账号）：

```powershell
# 只影响当前这次安装命令；幂等，可用 git config --global --unset url.ssh://git@github.com/.insteadOf 撤销
$env:GIT_CONFIG_GLOBAL = "$env:TEMP\dsh-gitconfig"
New-Item -ItemType File -Force $env:GIT_CONFIG_GLOBAL | Out-Null
git config --file $env:GIT_CONFIG_GLOBAL url."ssh://git@github.com/".insteadOf "https://github.com/"
# 保持该环境变量，再从 DSH 插件页/索引安装
```

**Q5：安装成功，但界面上没有新功能。**
① 确认点了「立即启用」且插件页开关是开；② 刷新页面；③ 仍然没有就重启 DSH Desktop（尤其替换过 Host 半代码时）。

**Q6：插件页显示异常/加载失败。**
先确认 DSH 版本（当前仓库适配 `0.2.2-rc.1`）；版本过旧会缺 API。确认插件文件夹完整（没有被杀软删除文件），必要时卸载重装。

**Q7：DSH 提示 profile 文件被占用/锁冲突。**
不要同时用插件页和外部 CLI 修改同一个 profile；等当前安装任务结束再试。

**Q8：通知不弹出。**
Windows 的系统通知/专注助手会拦截横幅，检查系统设置；`dsh-completion-notify` 的 README 有逐项排查。

**Q9：`dsh-usage-stats` 第一次打开很慢。**
第一次会冷扫描本机全部会话日志（几百 MB 级别），之后有缓存秒开；详见插件 README 的「性能」一节。

**Q10：可以一次性装全部 5 个吗？**
可以：方式 A 在发现页逐个点安装；方式 B 在插件页逐个粘贴路径。桌面端没有官方的「批量安装」入口，这是插件管理器的设计（一次只跑一个安装任务）。
