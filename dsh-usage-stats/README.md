# 用量统计 · Usage Stats

把「这台机器到底花了多少 Token、值多少钱」做成 DSH 左侧栏里的一张只读仪表盘。数据只来自本机会话日志，不联网、不上传。

- 包名：`@local/dsh-usage-stats`
- 版本：`1.1.0`
- 插件形态：Host 半（`index.js`）+ Web 客户端（`client.js`），安装后左侧栏出现「用量统计」入口
- 适配环境：DSH Desktop `0.2.2-rc.1`，Windows 11 实测
- 数据来源：本机 `$DSH_HOME/sessions` 下的会话日志（只读）；统计缓存写到 `$DSH_HOME/cache/dsh-usage-stats/`
- 网络行为：不联网
- 许可证：[MIT](../LICENSE)

> 安装 / 升级 / 卸载 / 排错的通用步骤见 [docs/INSTALL.md](../docs/INSTALL.md)；仓库总览与插件清单见[根 README](../README.md)。

## 功能

- **侧栏仪表盘**：左侧栏一个「用量统计」入口，打开即是一个独立面板；默认看**最近 7 天**，可切 30 天、90 天、全部时间。
- **KPI 区**：本周期 Token 总量、日均 Token、请求数、成本，以及三张卡片（Token 拆分、活跃会话数、预估成本）。Token 与成本卡片会和**前一个等长窗口**对比，且只比较已结束的完整天，今天刚产生的用量不会伪装成「下降」。
- **Token 时间线**：按天堆叠的柱状图（输入 / 输出 / 缓存命中 / 缓存写入），带每日均值虚线与峰值标记；无用量的日期是真实空档而不是被压缩的邻柱。悬停和左右方向键都能看当天明细。
- **成本构成**：左侧按模型的花费环形图，右侧每行一个模型的排行榜（厂商 · 模型、成本、占比），表中会标出是否用了兜底单价；前 8 个模型单列，其余折叠为「其他」。
- **供应商用量**：点选一个供应商，看它在本周期内的**按模型消耗**（调用次数 / Token / 成本 / 占比）和**按会话消耗**（哪个会话用了多少、用了该供应商的哪些模型、占该供应商的比例）；会话行可展开看该会话在该供应商下每个模型的拆分。数据来自同一次聚合，不额外请求。
- **会话明细**：范围内每个会话的 Token、成本、模型、缓存命中率、轮次、请求数、工具调用数，可排序、可搜索、可展开看整段会话生命周期的数据；表格固定六行高，内部滚动。
- **实时与增量**：面板打开时每 3 秒轻量轮询一次，正在运行的会话会持续累加；已落盘的会话只在内容变化时重新读取。

## 使用

1. 点击左侧栏的 **用量统计**，面板默认显示最近 7 天。
2. 用顶部分段控件切换范围：最近 7 天 / 30 天 / 90 天 / 全部时间。切换范围会重新取数，但只重算聚合，不重复扫描未变化的日志。
3. 右上角「重新扫描」会请求 Host 重新枚举并索引本机会话日志；首次打开面板时也会自动触发一次扫描。
4. 时间线支持鼠标悬停、键盘左右方向键查看单日明细；「全部时间」在超过 90 个自然日后自动按周聚合。
5. 会话明细可按会话 / 模型 / Token / 成本 / 最后活动排序，支持搜索标题、路径或模型；行可展开查看输入/输出/缓存拆分、缓存命中率、创建与活动时间、工作目录、Agent 预设等。
6. 「供应商用量」卡片顶部是一排供应商切换按钮：默认选中本周期成本最高的供应商；切换后模型列表与会话表同步更新，会话行可展开看该会话在该供应商下各模型的调用次数、Token 与成本。
7. 面板底部会注明数据来源与版本号；所有数字都是本机统计，不经过任何外部服务。

## 安装

> 通用步骤（含升级、卸载与排错）见 [docs/INSTALL.md](../docs/INSTALL.md)。要点：**每个插件独立安装**；路径必须是**绝对路径**（不能填仓库根目录，也不能是相对路径）；Desktop 的 `desktop` profile 请用插件页安装。

### 方式 B：插件页本地文件夹安装（推荐，离线可用）

1. 获取本仓库（`git clone` 或下载 ZIP 解压），得到插件目录。
2. 打开 DSH Desktop → 左侧栏 **插件** → 右上角 **添加插件**。
3. 填入本插件文件夹本身的绝对路径：

   ```text
   D:\github\dsh-plugins\dsh-usage-stats
   ```

4. Host 读出包名 / 版本 / 简介后点 **安装**，完成后点 **立即启用**（或之后在「已安装插件」里打开开关）。
5. 一般即时生效；若左侧栏没有出现入口，刷新页面或重启 DSH Desktop。

### 方式 A：从插件索引安装（需要 GitHub 可达）

前提：插件页有 **发现 / Discover** 标签（没有的话先在 **插件 → 实验性插件** 里启用「自定义插件索引」），且本机能访问 GitHub。

1. **插件** 页 → **发现** 标签 → **添加索引源**。
2. 填入仓库索引地址：

   ```text
   https://raw.githubusercontent.com/stuPETER12138/dsh-plugins/main/index.json
   ```

3. 在列表中找到「用量统计 / Usage Stats」→ **安装** → **立即启用**。

索引中的版本固定在 GitHub 的具体 commit 上，从仓库子目录安装，不需要手动 clone；没有网络时请改用方式 B。

### 方式 D：命令行（适用于非 Desktop 的 CLI profile）

```powershell
dsh plugin --profile <profile> add "link:D:\github\dsh-plugins\dsh-usage-stats"
```

DSH `0.2.2` 会在安装依赖后自动把组合包加入 profile 的 `dsh.profile.bundles`，重启该 profile 生效。Desktop 的 `desktop` profile 不建议用 CLI 直接改，交给桌面端插件页管理。

## 安装后确认生效

1. **插件页**：「已安装插件」列表里出现 `@local/dsh-usage-stats`，开关为开启状态。
2. **左侧栏**：出现「用量统计」入口；点开后能看到面板标题与统计范围切换。
3. **首次索引**：面板会显示「索引中 n/N」的进度胶囊，首次按会话数量可能要几十秒；完成后各卡片出数。
4. **缓存落盘**（可选）：索引完成后出现缓存文件 `$DSH_HOME/cache/dsh-usage-stats/summaries.v5.json`；再次打开面板应几乎立即出数。
5. **Host 路由**（可选，排错用）：在浏览器所在端口上请求只读接口，应返回 JSON 且 `version` 为 `4`：

   ```powershell
   # 端口以 DSH 实际监听的地址为准（看浏览器地址栏，如 http://127.0.0.1:59739）
   Invoke-RestMethod 'http://127.0.0.1:59739/dsh-usage-stats/live' | Select-Object version, revision
   ```

## 配置

插件开箱即用，`config` 全部可选；所有配置都写在 **profile 的 `cordis.patch.yml`** 里，针对 `usage-stats` 这一行做覆盖：

```yaml
# $DSH_HOME/profiles/<profile>/cordis.patch.yml
# Windows 默认位置：C:\Users\<用户名>\.dsh\profiles\desktop\cordis.patch.yml
- id: usage-stats
  name: '@local/dsh-usage-stats'
  config:
    prices:
      # 覆盖已内置的键：固定四价按字段合并；peak/offPeak 段请写全四个字段
      deepseek-official/deepseek-flash: { peak: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 }, offPeak: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 } }
      # 新增自定义模型：可写 flat 四价，也可带 peak / offPeak 两套
      my-provider/my-model: { input: 1.0, output: 3.0, cacheRead: 0.1, cacheWrite: 0.1 }
    fallback: { input: 1.0, output: 3.0, cacheRead: 0.1, cacheWrite: 0.1 }
    listIntervalMs: 15000   # 打开的面板重新枚举已存会话的间隔（毫秒）
```

- 单价单位是 **USD / 1M Token**；键可以是 `provider/model`，也可以是裸 `model`。
- 覆盖是**顶层字段合并**：对固定四价的键，只写 `input` 时输出、缓存读、缓存写继续用内置值；对 `peak` / `offPeak` 两段式的键，覆盖时请把该价格段的四个字段写全（价格段内部不做逐字段合并，缺的字段按 0 计价）。
- 缓存输入按 `cacheRead` 计价，未命中缓存的输入按 `input` 计价；`cacheWrite` 单独计价。
- 单价表变化会触发缓存整体失效（缓存按价格指纹校验），下次打开面板会重新扫描。
- 其余可调参数（一般无需改动）：`listIntervalMs`（默认 15000，范围 2000–3600000）、`readConcurrency`（默认 8，最大 8）、`readTimeoutMs`（默认 60000）、`maxScanMs`（默认 240000）、`maxSessions`（默认 2000，单次响应最多列出的会话数）。
- 改完配置后重启 DSH Desktop（或重新加载该 profile），再打开面板查看新价格。

### 内置价格表（USD / 1M Token）

以下 4 个键共用 DeepSeek 峰谷价：`deepseek-account/deepseek-flash`、`deepseek-official/deepseek-flash`、`intern/deepseek-v4.1-flash-1017`、`opencode-go/deepseek-v4.1-flash`。

- 高峰：输入 `0.30` / 输出 `1.20` / 缓存读 `0.006` / 缓存写 `0`
- 非高峰：上述三项减半（`0.15` / `0.60` / `0.003` / `0`）

固定单价：

| 模型键 | 输入 | 输出 | 缓存读 | 缓存写 |
| --- | ---: | ---: | ---: | ---: |
| `opencode-go/kimi-k3`、`bailian/kimi-k3` | 3.00 | 15.00 | 0.30 | 3.00 |
| `opencode-go/qwen3.8-max`、`bailian/qwen3.8-max-0902` | 2.00 | 6.00 | 0.25 | 2.50 |
| `opencode-go/claude-opus-5-5`、`openasi/claude-opus-5-5` | 4.00 | 20.00 | 0.20 | 5.00 |
| `opencode-go/gpt-6-astra`、`openasi/gpt-6-astra` | 10.00 | 50.00 | 1.00 | 12.50 |
| `stepfun/step-5-preview` | 0.55 | 2.20 | 0.055 | 0.55 |
| `intern/Agents-A1`、`intern/Sage-A1.5`、`intern/Atria-Dawn-Preview` | 0.30 | 1.20 | 0.03 | 0.30 |

- 兜底单价（表里没有的模型）：`input 1.00` / `output 3.00` / `cacheRead 0.10` / `cacheWrite 0.10`，并在面板上标记「使用了兜底单价」。
- 单价来源：DeepSeek 官方 API 价目表、OpenCode Console / OpenCode Go 价目表，核对日期 2026-11-06；`stepfun` 与部分 `intern` 模型没有公开价目表，沿用之前的估算。
- 高峰时段为 **UTC 01:00–04:00 与 06:00–10:00，周一至周五**，其余时间（含周末）非高峰、半价；每次调用按它**自己的开始时间**计价。DeepSeek 官方还会把中国法定节假日按非高峰计费，本插件没有建模这一点，节假日的工作日会按高峰价估算。

## HTTP 接口

Host 半只注册 3 个精确路由，供同源的浏览器半读取；完整字段说明见同目录 [API.md](API.md)（契约版本 v2，载荷 `version` 为 4）。

| 路由 | 用途 |
| --- | --- |
| `GET /dsh-usage-stats?days=<n>` | 完整载荷：`totals` + 指定范围 `range` + `sessions` + `prices` |
| `GET /dsh-usage-stats/live` | 轻量轮询：只含 `scan` 进度与 `totals` |
| `POST /dsh-usage-stats/refresh` | 请求重新扫描已存日志；已在扫描时返回 `alreadyRunning` |

- `days` 省略时默认 `7`；`0` 表示全部时间；正整数最大按 `3650` 截断。
- 只接受回环调用：peer 地址、`Host` 头、以及存在时的 `Origin` 头都必须是回环（`localhost` / `127.0.0.0/8` / `::1`），否则 403。
- 响应带 `cache-control: no-store`；错误统一为 `{ "error": { "code": "...", "message": "..." } }` 且状态码非 200。
- 载荷 v4（契约 v2）相对 v1 只新增 `sessions[].modelUsage`：每个会话在所选范围内按「供应商/模型」拆分的调用次数、Token 与成本；供应商卡片用它和 `range.models` 在浏览器端汇总，Host 没有新增路由。
- 第一次读取请求才懒启动首次扫描：从不打开面板的 profile 不会产生索引开销。

## 数据与隐私

- **只读本机会话**：Token 与成本来自 DSH 会话存储中的 `assistant/message.usage` 事件；插件通过 `sessionPersistence` / `sessionQuery` / `sessions` 这些公开服务读取，不自己解析日志文件格式，也不改动 `$DSH_HOME/sessions` 里的任何内容。
- **本地缓存**：聚合摘要缓存在 `$DSH_HOME/cache/dsh-usage-stats/summaries.v5.json`，每个会话约 1–1.5 KB（本机 226 条摘要的缓存约 300 KB）。缓存只保存 Token 计数、按模型/按天的分桶、会话标题、工作目录、Agent 预设等**元数据**，不保存对话正文；删掉该文件只会让下次打开面板重新扫描。
- **不联网**：插件没有网络请求，没有遥测，不上传任何数据；唯一对外暴露的是本机回环上的 3 个只读 JSON 接口。
- **缓存校验**：每条摘要都对应会话的持久化 revision（加上事件数与字节数）；revision 不匹配才重读那一个会话，因此过期缓存不会改变数字。价格表变化会让整份缓存失效。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半（约 57 KB）：索引会话日志、聚合、单价计算、3 个回环 HTTP 路由 |
| `client.js` | 浏览器半（约 152 KB，手写源码、无需构建）：侧栏入口与仪表盘 UI |
| `cordis.patch.yml` | 组合补丁：向 profile 插入 `usage-stats` 这一行 |
| `package.json` | 包声明：`dsh.bundle.patch` 与客户端注入配置 |
| `locale/zh.json`、`locale/en.json` | 插件管理页显示的中/英文标题与描述 |
| `icon.svg` | 插件图标 |
| `API.md` | Host ⇄ Client 的 JSON 契约（字段、示例、错误） |
| `README.md` | 本文件 |

## 工作原理

### 一半在 Host，一半在浏览器

- **Host 半**（`index.js`）通过 `ctx.get()` 取用 `webServer`、`sessions`、`sessionPersistence`，把会话日志折叠成轻量摘要，再按请求范围聚合，最后以 JSON 提供；它不渲染任何 UI。
- **浏览器半**（`client.js`）是普通的 DSH 客户端插件：向 `sidebar.panellist` 注册「用量统计」入口，向 `main` 注册同 id 的面板页面；所有数据通过同源 `fetch` 读取，自己不读会话日志。
- 面板打开后先取一次完整载荷（Host 若已从磁盘缓存恢复摘要，会很快返回），之后每 3 秒请求一次 `/live` 判断数据是否变化，变化时才重新取完整载荷。

### 数据从哪里来

| 数字 | 来源 |
| --- | --- |
| Token 用量与成本 | 会话日志里每条成功模型调用记录的 `assistant/message.usage` |
| 供应商 / 模型 / 会话拆分 | 同一条 `assistant/message.usage` 按 `message.source.provider` 与 `model` 分桶后，再按所选统计范围求和 |
| 会话、标题、活动时间 | `sessionPersistence.list()` 的轻量快照 + 每个变化会话的一次读取 |
| 实时会话 | 内存中的 `sessions` 会话存储，从上一次已计入的序号开始增量折叠 |

分叉（fork）或 seeded 会话的日志带有从父会话继承的前缀；统计时会跳过这段前缀，避免重复计入父会话的 Token。

### 扫描、缓存与增量

- **冷扫描**：把每个已存会话日志完整读一遍（解压 + JSON 解析），只为每个会话保留一份小摘要（约 2–3 KB）。
- **摘要缓存**：每份摘要按持久化 revision 缓存；重启后先用缓存立刻画面板，再按 revision 校验，只重读真正变化的会话。
- **分阶段、近的优先**：当前格式的会话先读、新的先读；需要格式迁移的旧日志放最后。面板在尾部仍在处理时就能显示进度和部分可用合计。
- **有界并发**：同时最多 8 个日志读取在途，避免解压线程挤占 Agent 循环；单个日志 60 秒超时，整轮扫描最长 240 秒后停止并报告已有结果。
- **旧格式日志**：优先走 `sessionQuery.readSession()` 的迁移读取；仍标记为 `migration-required` 且不在运行中的日志没有写入者，其缓存折叠结果保持权威，不会每次启动都重新迁移。

### 成本估算

每条 usage 按调用开始时间选择单价：有 `peak` / `offPeak` 两套价格的就按 UTC 峰谷判断，否则用固定四价；表中没有的模型用兜底单价并在面板标记。金额全程用浮点美元累加，Host 不做四舍五入，展示层再格式化。

### 时间线的聚合规则

- 时间线按本地自然日聚合、零填充：没有用量的日期保留为空档，不会被压缩。区间超过约 3 年（1100 天）时改用稀疏行。
- 「全部时间」超过 90 个自然日后，时间线自动按周聚合，均值线仍按天折算。
- 对比差值只统计**已结束的完整天**（当天的部分数据不参与对比）；范围是全部时间或 1 天时没有差值。

## 性能

开发期实测（217 个会话 / 218 个日志文件 / 88 MB 压缩日志）：

| 场景 | 首个载荷 | 校验扫描 | 读取日志数 |
| --- | --- | --- | --- |
| 冷启动，空缓存 | 0.04 s（部分数据） | 34 s | 217 |
| 有缓存重启 | 0.04 s（完整数据） | **0.12 s** | **0** |

冷扫描是唯一昂贵的一步：需要解压并解析数百 MB 日志；旧格式日志的读取成本还会数倍于当前格式。之后每次启动只重读变化的会话，通常为 0 个。无法读取的日志会被计数报告，而不是静默跳过。

v1.1.0 起完整载荷中每个会话多带一份按「供应商/模型」拆分的范围用量，体量通常为每会话一两百字节（本机 7 天 69 个会话的载荷约 64 KB），仍沿用同一次请求，不增加扫描与轮询次数；供应商视图在浏览器端按这份数据即时汇总。

## 开发

- 纯 ESM，无第三方依赖、无构建步骤；`index.js` 是 Host 源码，`client.js` 是浏览器源码，直接修改即可，无需编译。
- 语法检查：`node --check index.js`、`node --check client.js`。
- Host ⇄ Client 的接口以 [API.md](API.md) 为准；改载荷字段时先改契约再改两端。
- 仓库未附自动化测试；手工验证可借助上文「安装后确认生效」里的 `/live` 接口和缓存文件。仓库级开发约定见 [docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md)。
- 修改价格表常量（`index.js` 顶部的 `DEFAULT_PRICES` / `DEFAULT_FALLBACK_PRICE`）会改变缓存的价格指纹，测试时注意缓存失效带来的重扫。

## 卸载与数据清理

1. 关闭并卸载：DSH Desktop → **插件** → **已安装插件** → 关闭开关或点卸载（CLI profile 用 `dsh plugin --profile <profile> remove @local/dsh-usage-stats`）。
2. 关闭/卸载后侧栏入口与面板消失，Host 不再注册路由；重启 DSH 后彻底释放。
3. 删除统计缓存（可选，不影响任何会话数据）：

   ```powershell
   Remove-Item -Recurse -Force "$env:USERPROFILE\.dsh\cache\dsh-usage-stats"
   # 或按实际 $DSH_HOME 删除：$DSH_HOME\cache\dsh-usage-stats
   ```

4. 本插件不使用 `localStorage`，没有其他需要清理的浏览器数据；会话日志和附件不属于插件数据，不会被卸载流程删除。

## 已知限制

- **首次扫描慢**：空缓存时扫描几百个会话需要几十秒（开发机 217 个会话约 34 秒）；面板会显示进度，扫描结束后立即写缓存。
- **成本只是估算**：按配置的单价表计算，不等于供应商账单；缺价模型用兜底价并标记，价格表过期也会让估算偏差。
- **Token 是供应商上报值**：失败且没有上报 usage 的调用不计入；缓存读写口径完全按供应商日志。
- **峰谷规则不完整**：只按 UTC 工作日峰谷建模，不识别中国法定节假日；节假日工作日会按高峰价估算。
- **跨会话只能看本机**：只统计本 profile 能访问到的本机会话日志，不包含其他机器或其他 DSH_HOME 的数据。
- **供应商卡片依赖 Host 载荷版本**：供应商 / 模型 / 会话拆分来自 `sessions[].modelUsage`；Host 半与浏览器半版本不一致时（例如升级插件后还没重启 DSH），卡片会提示「Host 端版本较旧」，不会显示错误的数字。
- **供应商会话明细同样受会话上限影响**：与「会话明细」表一致，单次完整响应只列出范围内最近的 `maxSessions`（默认 2000）个会话。
- **会话列表有上限**：单次完整响应最多列出 `maxSessions`（默认 2000）个会话；极端情况下更老的会话不会出现在明细表。
- **不是资源监控**：只统计 Token 与成本，不监控 CPU、内存或进程状态。

## 兼容性

- 实测环境：**DSH Desktop `0.2.2-rc.1`**，Windows 11，DSH 自带 Node `24.21.0`；插件在本机 `desktop` profile 中已安装并启用。
- 本机运行状态（2026-11-07，插件 1.0.0）：`desktop` profile 的 `dsh.profile.bundles` 含 `@local/dsh-usage-stats`；`GET /dsh-usage-stats/live` 返回 `version: 3`、`scan.state: "idle"`，已索引 238 个会话；统计缓存 `summaries.v5.json` 有 226 条摘要（约 300 KB）。1.1.0 的供应商用量验证在隔离 profile + 真实数据副本上完成，未触碰真实 profile，记录见 [docs/VERIFICATION.md](../docs/VERIFICATION.md) 的增量验证。
- Host 半依赖 DSH 的 `webServer`、`sessions`、`sessionPersistence` 服务（旧格式日志会回退到 `sessionQuery`）；浏览器半依赖 `sidebar.panellist`、`main` 插槽与 `locale` 服务，且 `package.json` 中声明了 `immediately: true`。
- 更老的 DSH 版本可能缺少上述服务/插槽，未做兼容与测试；升级 DSH 后如面板异常，先查看 [docs/COMPATIBILITY.md](../docs/COMPATIBILITY.md) 与 [docs/INSTALL.md](../docs/INSTALL.md) 的排错章节。
- 插件本身无第三方 npm 依赖，不需要 `pnpm install` 或编译；宿主浏览器的 Chromium 能力即可满足图表（SVG）与界面渲染。

## 许可证

[MIT](../LICENSE) © 2026 stuPETER12138

---

更多插件：[返回仓库根 README](../README.md) · 安装与排错：[docs/INSTALL.md](../docs/INSTALL.md)
