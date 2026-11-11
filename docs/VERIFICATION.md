# 在 DSH Desktop 0.2.2-rc.1 上的安装与加载验证

本文件记录本仓库 5 个插件在 **当前真实 DSH 运行时**（DSH Desktop `0.2.2-rc.1`，Windows 11）
上的实测结果：每个插件都走完了「静态校验 → 安装 → 组合 → Host 启动 → client bundle 提供」
全链路，并按发布路径（插件市场索引、GitHub 子目录 git 安装）补充了验证。

- 验证日期：2026-11-07
- 验证对象：本仓库 `main` 上插件目录（对应提交 `417bb5c`）；`index.json` 固定在 `417bb5c`，索引提交为 `6fc08e3`（其后新增的提交仅包含本文档与 `scripts/verify-install.ps1`，不涉及插件内容）
- 验证方式：**隔离 DSH_HOME + 临时 profile + 本机 DSH Desktop 自带 CLI**，未登录、未联网安装、未触碰真实 `~/.dsh`
- 结果：**5/5 插件 PASS**；`index.json` 通过 DSH 真实校验器；GitHub 子目录 git 安装实测通过
- 一键复跑：`pwsh -File scripts/verify-install.ps1`（见 [复现](#复现步骤)）

## 结果汇总

| 插件 | 版本 | 静态校验 | 安装（link:） | bundle 组合 | Host 加载 | client bundle 提供 | 单元测试 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dsh-completion-notify | 1.0.0 | PASS | PASS | PASS | PASS | PASS | 无（无测试工具） | **PASS** |
| dsh-session-share | 0.1.0 | PASS | PASS | PASS | PASS | PASS | PASS（16 + 54 + 32 断言） | **PASS** |
| dsh-sticky-wall | 1.1.0 | PASS | PASS | PASS | PASS | PASS | 无（无测试工具） | **PASS**（1.2.0 增量见文末） |
| dsh-style-studio | 1.3.0 | PASS | PASS | PASS | PASS | PASS | 无（无测试工具） | **PASS** |
| dsh-usage-stats | 1.0.0 | PASS | PASS | PASS | PASS | PASS | 无（无测试工具） | **PASS**（1.1.0 增量见文末） |

整体断言数量（全部通过，0 失败）：

| 验证层 | 断言/检查数 | 结果 |
| --- | --- | --- |
| `scripts/verify-install.ps1`（安装 + 组合 + 启动 + client bundle） | 44 checks | 0 failure |
| `scripts/verify-repo.mjs`（仓库静态校验） | 289 checks | 0 failure, 0 warning |
| 独立静态/安全检查（本文档作者执行） | 5 插件 ×（14 项 manifest/YAML/exports/files/client 检查 + JS 语法 + locale） + 全仓扫描 | 0 failure |
| dsh-session-share 单元测试 | transcript 16 / export-core 54 / host 32 = 102 | 102 pass |
| `index.json` 真实校验器 | 32 断言（含 2 个负例） | 0 failure |
| 已发布索引（raw URL）复验 | 9 断言 | 0 failure |
| GitHub 子目录 git 安装 | 纯 HTTPS 2 插件 / SSH URL 重写 2 插件 + 启动加载 | 0 failure |
| 无头 Chrome 客户端加载探针 | 5 个 client 模块、2 个面板、侧栏入口 | 0 slot error、0 console error |

## 测试环境

| 项 | 值 |
| --- | --- |
| DSH | DSH Desktop `0.2.2-rc.1`（`app.asar` 内 `@deepseek-ai/dsh-plugin-market-index` 版本同为 `0.2.2-rc.1`；Web 端 `__DSH_BOOT__` 报告的构建 commit 为 `c59d10a`） |
| CLI | `D:\Software\DeepseekHarness\resources\runtime\cli\bin\dsh.cmd`（实测 `dsh -V` 输出 `0.2.2-rc.1`） |
| 运行时 | Node `24.21.0`、pnpm `11.28.5`（`resources/runtime/versions.json`） |
| 测试用 Node | 系统 Node `v26.8.1`（仅用于跑 `node --check` / 单元测试 / 校验器脚本） |
| OS | Windows 11（本机；逻辑回环地址 `127.0.0.1`） |
| Web 服务 | `dsh --profile <name> --port 0 --no-open`（本机回环随机端口） |

## 隔离与安全方法

全程不读写用户真实 DSH 环境，做法：

1. 每次验证新建临时目录，例如 `$env:TEMP\dsh-verify-run-1\home`，并只在该进程内设置
   `$env:DSH_HOME=<临时目录>`；CLI、pnpm、Web 服务全部继承该环境变量，profile 与缓存都落在临时目录。
2. 临时 profile 用 `--from-default-profile web` 从出厂 web 模板新建（`verifyweb` / `verifygit` / `verifyhttps`），
   不复制、不读取真实 `desktop` / `web` profile。
3. 安装用 `link:` 指向本仓库工作区做只读链接安装；GitHub 安装使用临时 profile 的独立 `node_modules`。
4. Web 服务用后台任务启动，检查完即 `taskkill /PID <pid> /T /F` 结束进程；无头 Chrome 也在检查后结束。
5. 每次验证后删除临时 `DSH_HOME`；本文档中的证据文件保存在仓库外的 `.dsh-tmp/` 下（未提交）。
6. 未修改真实 `C:\Users\<user>\.dsh`、真实 profiles、`开发机上的插件源目录`，也未对仓库做 git commit/push。

## 验证方法

### 1. 静态/安全检查

- 解析每个插件的 `package.json`：`name` 必须等于 `@local/<目录名>`、`version` 为 SemVer、`type: module`、`private: true`。
- `exports` / `main` 列出的每个文件必须存在（`./locale/*.json` 通配至少匹配一个文件）；`files[]` 条目（含目录与通配）存在。
- `dsh.bundle.patch` 指向的 YAML 可解析，且只 `insert` 一行、该行 `name` 与包名一致、`id` 合法。
- `dsh.client.platform === "web"`、`immediately === true`、`inject` 为字符串数组。
- `node --check` 检查插件内全部 `.js/.mjs/.cjs`（共 17 个文件）。
- `locale/en.json`、`locale/zh.json` 为合法 JSON。
- 全仓文本扫描：无真实用户主目录路径（`C:\Users\<user>`）、无开发机工作区绝对路径、无本机代理地址
  （本机常见本机代理端口段）、无密钥/密码模式命中。

### 2. 真实运行时安装与加载（隔离 profile）

```powershell
$env:DSH_HOME = '$env:TEMP\dsh-verify-run-1\home'
$cli = 'D:\Software\DeepseekHarness\resources\runtime\cli\bin\dsh.cmd'

# 创建临时 profile
& $cli --profile verifyweb --from-default-profile web --dump-config

# 逐个安装（DSH 0.2.2 会自动把组合包写入 profile 的 dsh.profile.bundles）
& $cli plugin --profile verifyweb add 'link:D:\github\dsh-plugins\dsh-completion-notify'
& $cli plugin --profile verifyweb add 'link:D:\github\dsh-plugins\dsh-session-share'
& $cli plugin --profile verifyweb add 'link:D:\github\dsh-plugins\dsh-sticky-wall'
& $cli plugin --profile verifyweb add 'link:D:\github\dsh-plugins\dsh-style-studio'
& $cli plugin --profile verifyweb add 'link:D:\github\dsh-plugins\dsh-usage-stats'

# 组合后的配置树
& $cli --profile verifyweb --dump-config

# 启动 web 服务（后台任务；输出 URL 后做 HTTP 检查）
& $cli --profile verifyweb --port 0 --no-open
```

判定标准：

- **安装**：`dsh plugin add` 退出码 0，输出含 `@local/<name>`；profile `package.json` 的 `dsh.profile.bundles`
  出现 5 个包名。
- **bundle 组合**：`--dump-config` 输出出现 5 个 `# == @local/<name>` 段及对应 `- id: <patch id>` /
  `name: '@local/<name>'` 行。
- **Host 加载**：web 服务启动无加载错误；`/` 返回的 `__DSH_BOOT__.entries` 列出 5 个 `@local/*` client 模块；
  Host 半带 HTTP 路由的插件（session-share、usage-stats）路由真实响应。
- **client bundle 提供**：按 boot 里的 `plugins/??@local/<name>/client.js&rev=<rev>` 逐条 GET，必须 200
  且字节数与仓库 `client.js` 一致（服务端附加 `//# sourceMappingURL=...` 行，约 +80 字节）。

### 3. 浏览器端加载（无头 Chrome）

用无头 Chrome（`--headless=new` + CDP）加载隔离环境 Web UI，等待 `__ModuleLoader__.mode === "live"` 后检查：

- 5 个 `style[data-dsh-plugin]` 是否全部注入（每个 client 模块 `apply()` 执行的直接证据）；
- `[data-slot-error]` 数量与 console/exception 事件；
- 侧栏入口是否渲染；打开「便签墙」「用量统计」面板并检查面板 DOM。

### 4. 插件市场索引校验（真实校验器）

从安装目录的 `app.asar` 抽出 DSH 自带的 `@deepseek-ai/dsh-plugin-market-index`（以及其依赖 `semver`），
直接 import 真实实现，调用：

```js
parseMarketIndex(JSON.parse(indexJson), 'https://raw.githubusercontent.com/stuPETER12138/dsh-plugins/main/index.json')
marketInstallTarget(plugin.name, version)
```

同时做两个负例（`format: 2`、7 位 commit）确认校验器确实会拒绝；并校验每个版本的 commit 在本仓库存在、
其 `path` 在该 commit 中存在、版本号与该 commit 里的 `package.json` 一致、内联 SVG 图标可解码且 < 32 KiB。

### 5. GitHub 子目录安装

用 `index.json` 生成的真实 spec 在隔离 profile 里安装：

```powershell
& $cli plugin --profile verifygit add "git+https://github.com/stuPETER12138/dsh-plugins.git#417bb5c13439cbba9be2139a2c2e1706ba4c6e9d&path:/dsh-sticky-wall"
```

注意（Windows 命令行细节）：`dsh.cmd` 用 `%*` 透传参数，而 `&path:` 中的 `&` 会被 `cmd.exe` 当作命令分隔符，
所以 PowerShell 里必须把整个 spec 再加一层引号作为一个 token 传入，否则 `&path:` 会被截断：

```powershell
$spec = 'git+https://github.com/stuPETER12138/dsh-plugins.git#<40位commit>&path:/dsh-sticky-wall'
$arg  = '"' + $spec + '"'          # 传给 dsh.cmd 时保留引号
& $cli plugin --profile verifygit add $arg
```

（DSH 插件管理器 UI / 市场「发现」安装不经 `cmd.exe`，直接以 argv 调 pnpm，无此问题；这是 CLI 包装层的
Windows 特有行为，已在注意项中记录。）

## 逐项证据

### 1) 静态/安全检查（最终提交状态）

5 个插件全部 PASS（脚本输出摘录）：

```text
[PASS] dsh-completion-notify (@local/dsh-completion-notify@1.0.0)
  checks: 14 | syntax files: 2 all ok=true | exports: 5 | files[]: 6 | locale: 2
  patch row: id=completion-notify name=@local/dsh-completion-notify
[PASS] dsh-session-share (@local/dsh-session-share@0.1.0)
  checks: 14 | syntax files: 9 all ok=true | exports: 5 | files[]: 9 | locale: 2
  patch row: id=session-share name=@local/dsh-session-share
[PASS] dsh-sticky-wall (@local/dsh-sticky-wall@1.1.0)
  checks: 14 | syntax files: 2 all ok=true | exports: 5 | files[]: 6 | locale: 2
  patch row: id=sticky-wall name=@local/dsh-sticky-wall
[PASS] dsh-style-studio (@local/dsh-style-studio@1.3.0)
  checks: 14 | syntax files: 2 all ok=true | exports: 5 | files[]: 6 | locale: 2
  patch row: id=style-studio name=@local/dsh-style-studio
[PASS] dsh-usage-stats (@local/dsh-usage-stats@1.0.0)
  checks: 14 | syntax files: 2 all ok=true | exports: 5 | files[]: 7 | locale: 2
  patch row: id=usage-stats name=@local/dsh-usage-stats

text files scanned: 59
forbidden machine paths: 0
repo clone-path examples (documented install path, accepted): 26
local proxy addresses: 0
possible secrets: 0
RESULT: PASS (0 failures)
```

- 全文 17 个 JS 文件 `node --check` 通过；JS 语法检查使用 DSH 运行时同一 Node 24.21.0 与系统 Node 26.8.1 均通过。
- 仓库中保留的 `D:\github\dsh-plugins\...` 只出现在安装文档示例中（文档要求用户 clone 到该路径），
  不含真实用户名、凭据或代理；`scripts/verify-install.ps1` 的默认 `-DshCli` 是本机 DSH Desktop 自带 CLI 路径，
  可用参数覆盖。
- 复制完整性：初始导入时 5 个插件目录逐文件 SHA-256 与 `开发机上的插件源目录` 完全一致（8/17/8/8/9 个文件）；
  之后为公开发布对文档/元数据做了清理（见提交 `417bb5c`）。

### 2) 安装与 bundle 组合

`dsh plugin add`（隔离 profile `verifyweb`）全部退出码 0，pnpm 输出（节选）：

```text
+ @local/dsh-completion-notify 1.0.0 <- ..\..\..\..\..\..\..\github\dsh-plugins\dsh-completion-notify
+ @local/dsh-session-share 0.1.0 <- ..\..\..\..\..\..\..\github\dsh-plugins\dsh-session-share
+ @local/dsh-sticky-wall 1.1.0 <- ..\..\..\..\..\..\..\github\dsh-plugins\dsh-sticky-wall
+ @local/dsh-style-studio 1.3.0 <- ..\..\..\..\..\..\..\github\dsh-plugins\dsh-style-studio
+ @local/dsh-usage-stats 1.0.0 <- ..\..\..\..\..\..\..\github\dsh-plugins\dsh-usage-stats
```

profile `package.json` 自动记录依赖与组合包（节选）：

```json
{
  "dependencies": {
    "@local/dsh-completion-notify": "link:D:/github/dsh-plugins/dsh-completion-notify",
    "@local/dsh-session-share": "link:D:/github/dsh-plugins/dsh-session-share",
    "@local/dsh-sticky-wall": "link:D:/github/dsh-plugins/dsh-sticky-wall",
    "@local/dsh-style-studio": "link:D:/github/dsh-plugins/dsh-style-studio",
    "@local/dsh-usage-stats": "link:D:/github/dsh-plugins/dsh-usage-stats"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@local/dsh-completion-notify",
        "@local/dsh-session-share",
        "@local/dsh-sticky-wall",
        "@local/dsh-style-studio",
        "@local/dsh-usage-stats"
      ]
    }
  }
}
```

`--dump-config` 组合树（节选，共 1259 行）：

```yaml
# == @local/dsh-completion-notify
- id: completion-notify
  name: '@local/dsh-completion-notify'
# == @local/dsh-session-share
- id: session-share
  name: '@local/dsh-session-share'
# == @local/dsh-sticky-wall
- id: sticky-wall
  name: '@local/dsh-sticky-wall'
# == @local/dsh-style-studio
- id: style-studio
  name: '@local/dsh-style-studio'
# == @local/dsh-usage-stats
- id: usage-stats
  name: '@local/dsh-usage-stats'
  config: {}
```

### 3) Host 启动与加载

```text
$ & dsh.cmd --profile verifyweb --port 0 --no-open
dsh web: http://127.0.0.1:57708/?token=<redacted>
```

- 启动过程无 error/exception 输出，服务进程稳定运行。
- 首页 HTML（41769 字节）的 `__DSH_BOOT__.entries` 含全部 5 个 `@local/*`（78 个 client 模块中的 5 个），
  例如：

```json
{ "id": "@local/dsh-sticky-wall", "url": "plugins/??@local/dsh-sticky-wall/client.js&rev=b00c17d329a9", "rev": "b00c17d329a9", "immediately": true }
```

- Host 半注册了 HTTP 路由的插件实测（带页面 token 的会话 cookie）：

| 请求 | 响应 | 说明 |
| --- | --- | --- |
| `GET /dsh-usage-stats?days=7` | `200`，`application/json`，3873 B | usage-stats Host 路由已挂载，返回聚合 JSON（`{"version":3,...}`） |
| `GET /dsh-usage-stats/live` | `200`，`application/json`，817 B | live 路由已挂载 |
| `GET /dsh-session-share/transcript?session=does-not-exist` | `404`，JSON `{"error":{"code":"session-not-found",...}}` | session-share Host 路由已挂载并进入业务判断 |
| `POST /dsh-session-share/transcript` | `405`，JSON `{"error":{"code":"method-not-allowed",...}}` | 只读路由方法限制生效 |

### 4) client bundle 由 `/plugins` 路由提供

按 `__DSH_BOOT__` 的 url/rev 逐条请求（同一 token 会话）：

| 插件 | HTTP | Content-Type | 响应字节 | 仓库 client.js 字节 | 结论 |
| --- | --- | --- | --- | --- | --- |
| dsh-completion-notify | 200 | text/javascript | 13703 | 13618 | PASS（+85B sourceMappingURL） |
| dsh-session-share | 200 | text/javascript | 92016 | 91935 | PASS（+81B） |
| dsh-sticky-wall | 200 | text/javascript | 33824 | 33745 | PASS（+79B） |
| dsh-style-studio | 200 | text/javascript | 38396 | 38316 | PASS（+80B） |
| dsh-usage-stats | 200 | text/javascript | 125179 | 125100 | PASS（+79B） |
| `@local/dsh-does-not-exist`（对照） | 404 | — | 0 | — | 未安装包不会被提供 |

响应内容与仓库文件逐字节一致，仅在末尾附加：

```js
//# sourceMappingURL=??@local/dsh-sticky-wall/client.js.map&rev=b00c17d329a9
```

### 5) 浏览器端加载（无头 Chrome + CDP，隔离环境）

`__ModuleLoader__.mode` 最终为 `live`，探针结果：

```json
{
  "moduleLoaderMode": "live",
  "pluginStyles": ["sticky-wall","session-share","usage-stats","completion-notify","style-studio"],
  "bootEntries": ["@local/dsh-completion-notify","@local/dsh-session-share","@local/dsh-sticky-wall","@local/dsh-style-studio","@local/dsh-usage-stats"],
  "slotErrors": [],
  "problems": []
}
```

- 5 个 client 模块的 `apply()` 均执行（各自注入 `style[data-dsh-plugin=...]`）。
- 侧栏渲染出「便签墙」「用量统计」入口（`document.body.innerText` 命中）。
- 点击「便签墙」：面板渲染（`sw-composer`/`sw-note` 等 5 个节点、空态文案），`slotErrors=0`。
- 点击「用量统计」：面板渲染并访问 Host 路由，显示「更新于 …」「本周期 Token 0 / 成本 $0 / 会话明细」空态，`slotErrors=0`。
- 全流程 console 无 error、无 exception。

### 6) dsh-session-share 单元测试（Node）

```text
$ node tools/test-transcript.mjs
SUMMARY pass=16 fail=0 skip=0
transcript test OK
$ node tools/test-export-core.mjs
PASS: 54 passed, 0 failed
$ node tools/test-host.mjs
32 passed, 0 failed
```

（`test-transcript.mjs` 在真实 `~/.dsh` 可读时会额外只读一条最近真实会话日志做冒烟；本环境以隔离 DSH_HOME 运行，
16 项全部通过。）

### 7) 仓库静态校验（`scripts/verify-repo.mjs`）

```text
$ node scripts/verify-repo.mjs
verify-repo: 5 plugin(s), 289 checks, 0 failure(s), 0 warning(s)
verify-repo: OK
```

### 8) 插件市场索引 `index.json`（真实校验器）

- 校验器来源：`app.asar` 内 `dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js`（0.2.2-rc.1，
  依赖 `semver` 一并从 `app.asar` 抽取），非手写模拟。
- 本地 `index.json`：`parseMarketIndex(...)` PASS；5 个插件、每插件 1 个版本；icon 内联 SVG 解码均 < 32 KiB。
- 负例控制：`format: 2` 与 7 位 commit 均被 `MarketIndexError` 拒绝（路径分别为 `$.format`、
  `$.plugins[0].versions[0].source.commit`），证明校验器真实生效。
- `marketInstallTarget` 输出（每个插件一条，全部断言 PASS）：

```text
git+https://github.com/stuPETER12138/dsh-plugins.git#417bb5c13439cbba9be2139a2c2e1706ba4c6e9d&path:/dsh-completion-notify
git+https://github.com/stuPETER12138/dsh-plugins.git#417bb5c13439cbba9be2139a2c2e1706ba4c6e9d&path:/dsh-session-share
git+https://github.com/stuPETER12138/dsh-plugins.git#417bb5c13439cbba9be2139a2c2e1706ba4c6e9d&path:/dsh-sticky-wall
git+https://github.com/stuPETER12138/dsh-plugins.git#417bb5c13439cbba9be2139a2c2e1706ba4c6e9d&path:/dsh-style-studio
git+https://github.com/stuPETER12138/dsh-plugins.git#417bb5c13439cbba9be2139a2c2e1706ba4c6e9d&path:/dsh-usage-stats
```

- 每个版本的 commit 在本仓库存在、`path` 在该 commit 中存在、版本号与该 commit 的 `package.json` 一致：
  全部 PASS。
- 已发布索引复验：从 `https://raw.githubusercontent.com/stuPETER12138/dsh-plugins/main/index.json` 取回
  （HTTP 200，14772 B），内容与本地/提交内容完全一致，`parseMarketIndex` 与 5 条 spec 再次 PASS。
- 远端确认：`git ls-remote` 远端 `main = 6fc08e3b73d978b521fa89e693d3eb72eab69a1d`（索引提交）；
  索引固定的代码 commit `417bb5c...` 即该提交的父提交，已 push。

### 9) GitHub 子目录安装（真实网络）

**A. 纯 HTTPS（无代理、无 URL 重写）**：临时 profile `verifyhttps` 直接安装 2 个插件，全部 PASS：

```text
$ & dsh.cmd plugin --profile verifyhttps add '"git+https://github.com/stuPETER12138/dsh-plugins.git#417bb5c13439cbba9be2139a2c2e1706ba4c6e9d&path:/dsh-sticky-wall"'
+ @local/dsh-sticky-wall 1.1.0
$ & dsh.cmd plugin --profile verifyhttps add '"git+https://github.com/stuPETER12138/dsh-plugins.git#417bb5c13439cbba9be2139a2c2e1706ba4c6e9d&path:/dsh-usage-stats"'
+ @local/dsh-usage-stats 1.0.0
```

- 安装后的 `node_modules/@local/<name>` 包含 `package.json`、`index.js`、`client.js`、`cordis.patch.yml`、
  `locale/*.json`、`icon.svg` 与 README（GitHub 子目录打包完整）；版本与索引一致。
- profile `dependencies` 记录完整 spec（含 `#commit&path:/dir`），`dsh.profile.bundles` 自动追加；
  `--dump-config` 出现对应行。

**B. 启动加载复验（同一 git 安装，SSH URL 重写路径）**：临时 profile `verifygit` 用 git spec 安装
`dsh-sticky-wall`、`dsh-usage-stats` 后启动 Web 服务：`__DSH_BOOT__` 列出两个包，client bundle 分别返回
`200`（33824 B / 122565 B；git checkout 为 LF 换行，故比工作区 CRLF 副本略小），组合树出现两行 → PASS。

**网络说明**：本机访问 GitHub 时通时断：

- 带残留代理环境变量 `HTTPS_PROXY=http://127.0.0.1:<port>` 时 git 立即失败（该端口无进程监听）；
- 去掉代理后用 `git+https` 直连 GitHub 成功（本次实测）；
- `raw.githubusercontent.com/main/index.json` 多次请求中 1 次 200、1 次超时，属网络抖动，不是索引内容问题。

## 未验证项与风险

| 项 | 状态 / 原因 | 影响 |
| --- | --- | --- |
| DSH Desktop `desktop` profile 与桌面 UI 内安装 | 未验证：约束要求不触碰真实环境，实测走 CLI 的隔离 web profile；桌面端与 web 共用同一 loader/pnpm 过程，风险低 | 需用户在真机做一次 UI 点击安装确认 |
| completion-notify 的系统通知实际弹出 | 未端到端验证：需要真实会话完成/等待授权事件（隔离 profile 无模型凭据、无会话） | OS 通知文案/点击聚焦行为未实测；模块加载、设置页注册代码路径已验证 |
| session-share 会话内「分享」页签交互 | 未验证：页签在活跃会话中出现，隔离 profile 未产生会话；Host 路由与 client 模块已验证 | 导出 Markdown/PNG/PDF 的真实点击流程未实测（单元测试覆盖导出核心 54 项） |
| style-studio「视觉风格」设置行点击换肤 | 未验证：设置页需要登录/模型配置，隔离 profile 未登录；模块 `apply()` 已通过 style 注入证明执行 | 五种风格的实际视觉切换未实测 |
| usage-stats 1.0.0 真实统计数字与图表 | 1.0.0 未验证：隔离 DSH_HOME 无会话日志，接口返回 0 值空态；1.1.0 的供应商用量卡片已用真实会话数据副本完成无头端到端验证（见文末增量记录） | 1.0.0 旧面板整体未在真实数据上回归；1.1.0 的供应商卡片、成本卡片与会话表渲染已实测，图表细节仍以视觉抽查为准 |
| 市场「发现」标签页端到端安装 | 未验证：需要启用可选插件「自定义插件索引」，且 raw URL 网络抖动；已用真实 validator + 真实 git 安装等价验证 | UI 点击流程未实测；spec 本身已实测可安装 |
| 非 Windows 平台 | 未验证（仅 Windows 11 实测） | 插件含 macOS/Linux 分支（如系统通知命令），未实测 |
| 更低 DSH 版本兼容性 | 未验证：仓库声明适配 0.2.2-rc.1，更低版本缺 slot API 可能无法加载 | 见 docs/COMPATIBILITY.md |
| GitHub 网络可达性 | 本机 raw/HTTPS 时通时断；无代理时 HTTPS git 成功 | 索引安装要求用户网络能访问 GitHub |
| git checkout 的 CRLF/LF 差异 | 提交内容为 LF，工作区复制为 CRLF；仅换行差异，加载与 dsh 无关 | 无功能影响 |
| `docs/`、`README` 中的 `D:\github\dsh-plugins` | 这是文档示例的 clone 路径（有意保留），非个人信息 | 不影响可移植性 |
| `scripts/verify-install.ps1` 默认 CLI 路径 | 默认指向本机 DSH Desktop 自带 CLI（`-DshCli` 可覆盖） | 其他机器需传参或安装 dsh CLI |

## 复现步骤

```powershell
# 1) 仓库静态校验
node scripts/verify-repo.mjs

# 2) 真实运行时：安装 + 组合 + 启动 + client bundle 断言（隔离 DSH_HOME，自动清理）
pwsh -File scripts/verify-install.ps1
#   可指定本机 CLI / 临时目录：
pwsh -File scripts/verify-install.ps1 -DshCli 'D:\Software\DeepseekHarness\resources\runtime\cli\bin\dsh.cmd' -TempHome "$env:TEMP\dsh-verify-manual"

# 3) 单元测试
cd dsh-session-share
node tools/test-transcript.mjs
node tools/test-export-core.mjs
node tools/test-host.mjs

# 4) 索引校验（需从 app.asar 抽出 @deepseek-ai/dsh-plugin-market-index 与 semver 后 import）
#    parseMarketIndex(JSON.parse(fs.readFileSync('index.json')), '<index raw URL>')
#    marketInstallTarget(plugin.name, version)
```

`scripts/verify-install.ps1` 参数与行为：

| 参数 | 说明 |
| --- | --- |
| `-DshCli` | dsh CLI 可执行路径，默认本机 DSH Desktop 自带 `dsh.cmd` |
| `-RepoRoot` | 仓库根目录，默认脚本所在目录的上一级（可从任意工作目录运行） |
| `-TempHome` | 临时 DSH_HOME，默认系统临时目录下的 `dsh-plugins-verify-*`；只允许临时位置（系统 temp 或 `.dsh-tmp`），并拒绝清空真实 `~/.dsh` |
| `-ProfileName` | 临时 profile 名，默认 `verify-install` |
| `-StartupTimeoutSec` | Web 启动等待秒数，默认 120 |
| `-KeepTempHome` | 保留临时目录便于排查 |

脚本退出码：`0` 全部通过；`1` 有失败（逐条打印原因）。每次运行结束都会停止后台 web 服务进程。

## 增量验证：dsh-usage-stats 1.1.0 供应商用量（2026-11-10）

本记录针对**工作区中的未提交变更**（插件版本 `1.1.0`，载荷 `version: 4`），不是已发布索引的一部分；
验证对象只有 `dsh-usage-stats`，其余插件与 1.0.0 的记录相同。

**新增功能**：面板新增「供应商用量」卡片——选定一个供应商后，看它在本统计范围内的按模型消耗
（调用次数 / Token / 成本 / 占比）与按会话消耗（哪些会话用了多少、会话内按模型的拆分）。
数据来自 Host 在同一份载荷中新增的 `sessions[].modelUsage`；没有新增 HTTP 路由。

**方法**（全程隔离，未触碰真实 `~/.dsh` 与正在运行的 DSH Desktop）：

1. 新建临时 `DSH_HOME`，用出厂 `web` 模板建临时 profile，`dsh plugin add "link:<仓库>/dsh-usage-stats"` 安装；
2. 把真实会话存储与统计缓存**只读复制**进临时 home（283 个会话文件、124.9 MiB + `summaries.v5.json`），
   因此面板拿到的是真实数据而不是空态；
3. `dsh --profile <临时> --port 0 --no-open` 启动隔离 Web 服务，Node 脚本取三个范围的载荷并做独立重聚合校验；
4. 用无头 Edge（CDP，`--headless=new`）打开真实页面：点击侧栏「用量统计」，断言卡片选择、行数、数值、
   供应商切换、会话展开，并截图；同时检查控制台/插槽错误；
5. Harness 自检：对 `git archive HEAD` 的旧版插件（1.0.0）跑同一套断言，必须失败——
   实测 26 项契约失败并识别出「payload version 3 / 卡片缺失」，证明绿测不是默认通过。

**结果**：71/71 断言通过（HTTP + 浏览器 + 回归 + 模型列表表头），0 失败、0 跳过。

| 范围 | 会话 | 模型 | 供应商 | 请求 | Token | 成本 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 最近 7 天 | 69 | 4 | 3 | 3,530 | 754,154,394 | $10.874948 |
| 最近 30 天 | 116 | 11 | 6 | 7,765 | 1,682,124,420 | $38.963906 |
| 全部时间 | 280 | 14 | 8 | 14,130 | 2,488,738,555 | $140.799402 |

- HTTP 不变量：三个范围的 `version` 均为 4；每个会话都有 `modelUsage` 数组且字段类型正确；
  `provider/model` 为键的首段/其余部分；按 Token 降序；旧有 `models` 数组与 `modelUsage` 键一致；
  每个会话 ΣToken/Σ成本/Σ调用 = 行内合计；`range.models` 与独立重聚合一致；供应商维度合计一致；
  `/dsh-usage-stats/live` 为 version 4；`/dsh-usage-stats/provider?...` 与未知子路由均 404（确认未新增路由）。
- 浏览器：卡片 `data-state="ready"`、默认选中成本最高的供应商；chip 数量/顺序/单选状态与载荷一致；
  7 天 60 个会话行、2 个模型行（模型列表带「调用 / Token / 成本 / 占比」表头）；事实数字与载荷一致（如 Token 660,352,332 / $9.9938 / 3,305 次 / 60 个会话）；
  切换供应商后行数与模型行随之更新；展开会话行出现按模型明细与「占该供应商」占比；
  存量时间线、成本卡片、会话表与范围切换均正常；0 控制台错误、0 插槽错误、未请求新路由。
- 静态检查：`node --check index.js`、`node --check client.js` 均通过；`node scripts/verify-repo.mjs`
  为 5 插件 / 294 检查 / 0 失败 / 0 警告。

**证据**（临时目录，未提交，已被 `.gitignore` 的 `.verify-*/` 覆盖）：
`.verify-usage-stats/evidence/20261110-001328-phase-b-final2/`（results.json、browser-observations.json、
driver.log、orchestrator.log、脱敏载荷、截图）与 `.verify-usage-stats/screenshots/`。

**残余风险与说明**：

- 验证 harness 依赖本机 Edge 与真实数据副本，未提交到仓库，无法在本仓库一键复跑；复跑方法记录在
  `.verify-usage-stats/README.md`（临时目录，不随插件发布）。
- 真实 `desktop` profile 中已安装的插件副本仍是 1.0.0，本次未触碰；要让新卡片生效，需要把工作区
  的变更更新到安装源并重启 DSH（Host 半变化必须重启，浏览器半刷新可更新）。
- 会话数会随正在运行的 DSH 持续写入而变化，上表数字取自同一次载荷快照；面板断言在浏览器阶段重新取载荷，
  两者时间差小于 1 秒。

## 增量验证：dsh-sticky-wall 1.2.0 便签交错紧密排列（2026-11-10）

本记录针对**工作区中的未提交变更**（插件版本 `1.2.0`），不是已发布索引的一部分；
验证对象只有 `dsh-sticky-wall`，其余插件与上文记录相同。

**新增功能**：便签墙从等高网格改为按「当前最短列」落位的瀑布流——每条便签按自身文字高度排列，长短不一时
卡片紧密交错，不再像网格那样在短便签下方留出整行空洞；窗口缩放、侧栏变宽变窄、编辑框长高时都会重新排列。
数据格式、localStorage 键、侧栏入口，以及搜索 / 置顶 / 复制 / 删除 / 撤销行为均未改变。

**方法**（全程隔离，未触碰真实 `~/.dsh` 与正在运行的 DSH Desktop）：

1. 新建临时 `DSH_HOME`，用出厂 `web` 模板建临时 profile，`dsh plugin add "link:<仓库>/dsh-sticky-wall"` 安装；
2. `dsh --profile <临时> --port 0 --no-open` 启动隔离 Web 服务，读取带 token 的地址；
3. 无头 Edge（CDP，`--headless=new`）在页面脚本执行前写入 9 条长短不一的便签（含题图中的四条），
   打开侧栏「便签墙」，在 1400×900 / 800×900 / 520×900 三个视口，以及新增、编辑中、取消编辑三个交互状态下，
   量取每张卡片的包围盒与墙的尺寸；
4. 断言（容差写入结果文件）：列数与 `floor((墙宽 + 14) / (228 + 14))` 一致、同列左缘与宽度一致、
   列间距 14±1px、同列相邻卡片垂直缝隙 14±1px、任意两张卡片不重叠、卡片不越出墙宽、
   墙高等于最高列底部 ±1px；
5. Harness 自检：对 `git show HEAD:dsh-sticky-wall/client.js` 的 1.1.0 网格布局跑同一套断言，必须失败——
   实测 9 项失败（三个视口与新增 / 编辑 / 取消后的 `*-tight`，以及样式契约），证明绿测不是默认通过。

**结果**：当前实现 45/45 断言通过（静态 2 + 浏览器 43），0 失败、0 跳过；1.1.0 基线 36/45（9 项失败）。

| 视口 | 墙宽 | 列数 | 列宽 | 列间距 | 同列缝隙 | 墙高 |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| 1400×900 | 1015px | 4 | 243.25px | 14/14/14px | 5 处均为 14px | 328px |
| 800×900 | 671px | 2 | 328.5px | 14px | 14px | 534px |
| 520×900 | 463px | 2 | 224.5px（`--sw-wall-min` 切到 200px） | 14px | 14px | 644px |

- 交互：输入框 `Ctrl+Enter` 后 9→10 条，新便签排在首位、计数与 localStorage 同步，重排后 0 重叠 / 45 对；
  双击编辑时输入框 98px→334px（未保存），墙高 475px，仍 0 重叠；`Esc` 取消后文本恢复、卡片收回。
- 静态检查：`node --check client.js` 通过；`node scripts/verify-repo.mjs` 为 5 插件 / 294 检查 / 0 失败 / 0 警告。
- 控制台：0 个错误 / 未捕获异常；浅色主题生效。

**证据**（临时目录，未提交，已被 `.gitignore` 的 `.verify-*/` 覆盖）：
`.verify-sticky-wall/evidence/20261110-161050-current3/`（results.json、layout-snapshots.json、driver.log、
orchestrator.log、8 张截图）与 `.verify-sticky-wall/evidence/20261110-161121-baseline-final/`（基线 9 项失败）。

**残余风险与说明**：

- 断言 `W4-wide-height` 在网格布局下按构造也会通过（最后一行底部即墙高），真正区分瀑布流的是同列缝隙
  （`*-tight`）与样式契约；9 项失败全部来自这两类。
- 便签按最短列落位，底部边缘参差是设计取舍；编辑中的卡片只在自身列内变高、不会跳列，但会推动同列下方卡片。
- 本机 `desktop` profile 安装的插件副本已同步为本次代码（`D:\Project\dsh-normal\plugins\dsh-sticky-wall`，
  package.json 版本同为 `1.2.0`），刷新页面即可生效；未重启 DSH Desktop，未改真实 profile 配置。

## 增量验证：dsh-session-share 0.2.1 格式与下载按钮移到顶部（2026-11-11）

本记录针对**工作区中的未提交变更**（插件版本 `0.2.1`），不是已发布索引的一部分；
验证对象只有 `dsh-session-share`。

**改动**：`分享` 视图原来把 Markdown / 图片 / PDF 切换条与下载按钮放在面板**最底部**的 `footer`
里，`ss-body` 高 `min(70vh,860px)`，内容稍多时这排按钮就落到视口下方，必须滚动才能换格式或导出。
现在把它们移到标题下方、消息列表上方的 `ss-actions` 工具栏：左侧格式切换，右侧是实时状态
（「已开始下载。共 N 页」或报错）、「复制 Markdown」（仅 Markdown 格式）和主下载按钮；
底部 footer 与 `.ss-privacy` 段落一并移除，隐私说明并入标题下的副标题行。
同时给 `ss-shell` 设 `box-sizing:border-box`，避免窄窗口下工具栏被容器裁掉。

**方法**（全程隔离，未触碰真实 `~/.dsh` 与正在运行的 DSH Desktop）：

1. 新建临时 `DSH_HOME`，用出厂 `web` 模板建临时 profile，`dsh plugin add "link:<仓库>/dsh-session-share"` 安装；
   写入**占位** `DEEPSEEK_API_KEY`（全部为假值，只为跳过首次运行的登录引导，不联网、不复制真实密钥）；
2. 从真实会话库**只读**挑出 3 个最小的「主会话」日志（子代理日志在侧栏不可见，会被判为空），拷进临时
   `sessions/<工作区>/`；
3. `dsh --profile <临时> --port 0 --no-open` 启动隔离 Web 服务，读取带 token 的地址；
4. 无头 Edge（CDP，`--headless=new`）打开该地址，关掉引导弹窗，点侧栏第一条会话，再点「分享」页签；
5. 断言（DOM 几何 + 行为）：
   - 静态 6 项：`client.js` 仍是 `__ModuleLoader__` 模块、`ss-actions` 渲染位置先于 `ss-body`、
     `ss-formats` 与 `ss-button-primary` 都在 `ss-actions` 内、`.ss-foot` 规则与标记均已消失、隐私说明在副标题里；
   - 布局 9 项：工具栏可见、格式三键与下载按钮在工具栏内、无 `.ss-foot`/`<footer>`、隐私说明唯一、
     工具栏底边 ≤ 正文与列表顶边、紧跟标题、列表渲染 6 条且主按钮可用；
   - 行为 5 项：切「图片」→ 按钮变「下载图片」且无复制键；切 Markdown → 「复制 Markdown」+「下载 .md」同排；
     切 PDF → 「下载 PDF」；点顶部主按钮真的产出 `application/pdf` Blob（154 291 字节，头 `%PDF-1.4`），
     并在同一工具栏显示「已开始下载。 共 1 页」；
   - 响应式 4 项：560×900 下工具栏仍可见、无横向溢出、仍在列表上方、按钮右缘 536px 未超出面板 553px 与视口 560px；
   - 控制台 1 项：无提及 `ss-` / `session-share` 的错误；
6. Harness 自检：对 `git archive HEAD:dsh-session-share` 的旧实现（底部 footer）跑同一套断言，必须失败。

**结果**：当前实现 28/28 断言通过（静态 6 + 浏览器 22），0 失败、0 跳过；HEAD 基线 7/28（21 项失败，
静态 5 + 布局 9 + 行为 5 + 响应式 3），证明断言确实会咬。

| 视口 | 工具栏位置 | 工具栏尺寸 | 正文顶边 | 列表顶边 | 下载按钮右缘 |
| --- | --- | --- | ---: | ---: | ---: |
| 1440×1000 | 标题下方（head 底 152px） | 760×51px | 203px | 248px | 在面板内 |
| 560×900 | 标题下方（head 底 146px） | 520×69px | 215px | 260px | 536px（面板 553px） |

- 静态检查：`node --check client.js` 通过；单元测试仍全绿（transcript 16 / export-core 88 / latex 40 / host 32）。
- 截图证据：1440 宽面板、导出后状态、560 宽面板、最终状态共 4 张。

**证据**（临时目录，未提交，已被 `.gitignore` 的 `.verify-*/` 覆盖）：
`.verify-share-topbar/evidence/20261111-150638-current6/`（results.json、dom-snapshots.json、browser-steps.json、
driver.log、orchestrator.log、4 张截图）与 `.verify-share-topbar/evidence/20261111-150715-baseline2/`（基线 21 项失败）。

**残余风险与说明**：

- 隔离实例用的是**伪造** API Key 与**拷贝**的会话日志，只验证界面与导出链路；真实登录、真实 token 计量未覆盖。
- 导出探测抓的是 `URL.createObjectURL` 产出的 Blob（大小、MIME、`%PDF-` 头），不落盘，因此没有验证
  浏览器下载目录里的文件名；文件名逻辑由 export-core 单测覆盖。
- 工具栏本身不吸顶（不 `position:sticky`）：它本来就在列表上方，会话很长时列表在 `ss-items` 内滚动，
  工具栏始终可见。
- 本机 `desktop` profile 安装的插件副本已同步为本次代码（`D:\Project\dsh-normal\plugins\dsh-session-share`，
  package.json 版本同为 `0.2.1`），刷新页面即可生效；未重启 DSH Desktop，未改真实 profile 配置。

## 结论

在 DSH Desktop `0.2.2-rc.1` 上，5 个插件均可通过真实 CLI 安装、进入 profile 组合包、由 Host 启动加载，
并由 `/plugins` 路由提供各自的浏览器模块；仓库静态校验、session-share 单元测试、插件市场索引
（真实校验器 + 已发布 raw 索引）与 GitHub 子目录 git 安装均通过。未验证项集中在**需要真实登录会话或
桌面 UI 交互**的功能细节，不影响「可安装、可加载」的结论。
