# 用量与资源 · Usage & Resources

左侧栏里的一张只读面板，回答三个问题：这段时间用了多少 Token、折合多少钱；DSH 在本机占了多少 CPU、内存和磁盘；哪些已归档的旧会话可以删掉、能腾出多少空间。

数字全部来自本机，不联网、不上传。

- 包名：`@local/dsh-usage-stats`，版本 `3.0.0`
- 形态：Host 半（`index.js`，读日志、采样资源、量磁盘、出 JSON）+ Web 客户端（`client.js`，一张面板）
- 数据来源：`$DSH_HOME/sessions` 下的会话日志（只读）、`assistant/message.usage` 事件、Node `process` / `os` 计数器、`$DSH_HOME` 下的磁盘目录
- 本地缓存：`$DSH_HOME/cache/dsh-usage-stats/summaries.json`，删掉只会让下次打开重新扫描
- 许可证：[MIT](../LICENSE)

安装步骤见 [docs/INSTALL.md](../docs/INSTALL.md)，仓库总览见[根 README](../README.md)。

## 面板

打开左侧栏的「用量与资源」，一张页面从上到下是：

1. **统计范围**：右上角 30 天 / 90 天 / 全部，默认 90 天；切换后按新范围重新聚合。
2. **概览卡**：左边是 Token 日历，右边是六个数字——Token 用量（附输入 / 输出 / 缓存命中拆分）、预估成本、消息数、会话数、活跃天数、最常用模型。
3. **资源占用**：四个数字——CPU（整机百分比，附 Host 进程自身占用与核数）、DSH 内存（整应用进程合计，附占全机比例与进程数）、系统内存（已用 / 总量，附可用）、会话日志占用（附会话数与附件占用）。每 5 秒刷新，磁盘每 15 秒重新量一次。
4. **模型用量**：范围内每个模型的 Token、成本与占比，按 Token 量排序；占比不到 1% 的模型折叠成「其他」。
5. **会话用量**：范围内用掉 Token 的会话，按最近活动排序，最多 100 个；运行中的会话前面有小圆点。
6. **可回收空间**：已归档、且最后一次写入早于 90 天的会话清单——每行有勾选框、标题、大小、最后写入日期；底部给出「N 个会话可删除 / 可释放 X MB」，选中后点删除还要再确认一次，Host 复核通过才真正删除。

日历的宽度跟着范围走：30 天约 6 列，90 天约 14 列，全部时间从第一天铺到今天。

面板打开时每 5 秒取一次数据；Host 每 15 秒重新枚举一次会话日志，只重读内容变过的那几个。

## 可回收空间怎么算

规则只有一条，Host 与面板用的是同一份实现（`storage.js`）：

> **会话已归档** 且 **该会话目录里最后一次写入早于 `cleanup.days` 天前**（默认 90 天）且 **当前没有在运行**。

- 「最后写入」取目录里最新文件的 mtime，不是最后一条事件的时间：重新打开过、继续聊过的会话会自动离开候选集。
- 已归档的会话才能进候选：归档是 DSH 的「隐藏」标记，它本身不省任何空间（你的 144 个归档会话仍然占着全部日志的 56%），这正是这个卡片存在的原因。
- 大小是整个会话目录的实际占用，包含历史格式代际（v3 / v4 各一份时都算）。
- 预览（dry run）就是面板打开时看到的那张表，也可以离线跑：

  ```powershell
  node scripts/storage-audit.mjs --days 90          # 表格预览
  node scripts/storage-audit.mjs --days 90 --json   # 机器可读
  ```

  脚本只读；加 `--apply --confirm` 才会删除，删的仍是同一套规则选出来的会话。

- 删除是不可恢复的。**只删会话日志目录**，不动 `attachments`、`storages`、`cache`，也不改归档标记；删完后 `archivedSessionIds` 里会留下一条没有对应日志的 id，DSH 允许这种状态（取消归档仍会成功，不会产生未知引用），下次刷新侧栏时该会话自然消失。

### 删除路径上的三道闸

1. 面板：勾选 → 点删除 → 再点「确认删除」，两次都在同一个卡片内，不弹系统对话框。
2. Host 复核：`POST` 必须带 `confirm: true` 和明确的 id 列表；Host 会重新量一次磁盘、重新算一次计划，任何不再符合规则的 id 都会被拒绝（`409 not-eligible`），一个都不删。
3. 文件系统：只接受本次扫描出来的会话行，目录必须是 `<sessions root>/<分组>/<会话 id>`，basename 必须等于 id，越界路径直接判失败。

## 使用

1. 点击左侧栏的 **用量与资源**，默认看最近 90 天。
2. 用右上角的分段控件切换 30 天 / 90 天 / 全部时间。
3. 首次打开会先显示「索引中 n/N」，Host 正在把会话日志折叠成摘要。
4. 想清理旧会话：滚到「可回收空间」，勾选（或全选）→ 删除 → 确认删除。

## 安装

> 通用步骤（含升级、卸载与排错）见 [docs/INSTALL.md](../docs/INSTALL.md)。要点：**每个插件独立安装**；路径必须是**绝对路径**（不能填仓库根目录，也不能是相对路径）；Desktop 的 `desktop` profile 请在插件页安装。

### 方式 B：插件页本地文件夹安装（推荐，离线可用）

1. 获取本仓库（`git clone` 或下载 ZIP 解压）。
2. 打开 DSH Desktop → 左侧栏 **插件** → 右上角 **添加插件**。
3. 填入本插件文件夹本身的绝对路径，例如 `D:\github\dsh-plugins\dsh-usage-stats`。
4. 确认包名 / 版本 / 简介后点 **安装**，再点 **立即启用**。
5. 左侧栏出现「用量与资源」入口；没有的话刷新页面或重启 DSH Desktop。

### 方式 A：从插件索引安装（需要 GitHub 可达）

1. **插件** 页 → **发现** 标签 → **添加索引源**，填入
   `https://raw.githubusercontent.com/stuPETER12138/dsh-plugins/main/index.json`。
2. 找到「用量与资源 / Usage & Resources」→ **安装** → **立即启用**。

### 方式 D：命令行（非 Desktop 的 CLI profile）

```powershell
dsh plugin --profile <profile> add "link:D:\github\dsh-plugins\dsh-usage-stats"
```

## 安装后确认

1. **插件页**：「已安装插件」里出现 `@local/dsh-usage-stats`，开关是开启状态。
2. **左侧栏**：出现「用量与资源」入口，点开后能看到概览、资源占用、可回收空间三张卡。
3. **Host 路由**（可选，排错用；端口以浏览器地址栏为准）：

   ```powershell
   Invoke-RestMethod 'http://127.0.0.1:59739/dsh-usage-stats?days=7' | Select-Object generatedAt
   Invoke-RestMethod 'http://127.0.0.1:59739/dsh-usage-stats/cleanup' | Select-Object -ExpandProperty cleanup
   ```

4. **缓存落盘**（可选）：索引完成后出现 `$DSH_HOME/cache/dsh-usage-stats/summaries.json`。

## 配置

插件开箱即用；`config` 写在 profile 的 `cordis.patch.yml` 里 `usage-stats` 那一行（Windows 默认 `C:\Users\<用户名>\.dsh\profiles\desktop\cordis.patch.yml`）：

```yaml
- id: usage-stats
  name: '@local/dsh-usage-stats'
  config:
    prices:
      # 覆盖内置价：同一个键整条替换，四个价写全
      deepseek-official/deepseek-flash: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 }
      # 也可以加自己的模型；键可以是 provider/model，也可以是裸 model
      my-provider/my-model: { input: 1.0, output: 3.0, cacheRead: 0.1, cacheWrite: 0.1 }
    fallback: { input: 1.0, output: 3.0, cacheRead: 0.1, cacheWrite: 0.1 }
    cleanup:
      days: 90              # 可回收空间的最小年龄，默认 90，夹在 1..3650
    resources:
      appProcesses: true    # Windows 上把整个 Desktop 进程树的内存加起来，默认开
```

- 单价单位是 **USD / 1M Token**；`fallback` 用于价目表里没有的模型，面板会给这些模型加注。
- `prices` 的每一项**整条替换**内置价：写平价格式就四个字段都写全；写峰谷格式（`peak` / `offPeak` 两段）也是每段四个字段。
- 改了价格会改变缓存的价格指纹，下次打开会按新价重算一遍。
- `cleanup.days` 改了不需要重启：下一次轮询就按新窗口算计划。
- 改完配置重启 DSH Desktop（或重新加载该 profile），再打开面板。

### 内置价格表（USD / 1M Token）

以下键共用 DeepSeek 峰谷价：`deepseek-account/deepseek-flash`、`deepseek-official/deepseek-flash`、`intern/deepseek-v4.1-flash-1017`、`opencode-go/deepseek-v4.1-flash`。

- 高峰（UTC 01:00–04:00 与 06:00–10:00，周一至周五）：输入 `0.30` / 输出 `1.20` / 缓存读 `0.006` / 缓存写 `0`
- 其余时间（含周末）：上述三项减半，`0.15` / `0.60` / `0.003` / `0`

| 模型键 | 输入 | 输出 | 缓存读 | 缓存写 |
| --- | ---: | ---: | ---: | ---: |
| `opencode-go/kimi-k3`、`bailian/kimi-k3` | 3.00 | 15.00 | 0.30 | 3.00 |
| `opencode-go/qwen3.8-max`、`bailian/qwen3.8-max-0902` | 2.00 | 6.00 | 0.25 | 2.50 |
| `opencode-go/claude-opus-5-5`、`openasi/claude-opus-5-5` | 4.00 | 20.00 | 0.20 | 5.00 |
| `opencode-go/gpt-6-astra`、`openasi/gpt-6-astra` | 10.00 | 50.00 | 1.00 | 12.50 |
| `stepfun/step-5-preview` | 0.55 | 2.20 | 0.055 | 0.55 |
| `intern/Agents-A1`、`intern/Sage-A1.5`、`intern/Atria-Dawn-Preview` | 0.30 | 1.20 | 0.03 | 0.30 |

- 兜底单价：`input 1.00` / `output 3.00` / `cacheRead 0.10` / `cacheWrite 0.10`。
- 单价来源：DeepSeek 官方 API 价目表、OpenCode Console / OpenCode Go 价目表，核对日期 2026-11-06；`stepfun` 与部分 `intern` 模型没有公开价目表，沿用之前的估算。
- 每次调用按它**自己的开始时间**选价；DeepSeek 官方的中国法定节假日不计为高峰，这里没有建模，节假日工作日会按高峰价估算（略偏高）。

## HTTP 接口

Host 半只注册两个精确路由，供同源的浏览器半读取；字段说明见同目录 [API.md](API.md)。

| 路由 | 方法 | 用途 |
| --- | --- | --- |
| `/dsh-usage-stats?days=<n>` | GET | 一个范围的完整载荷：`totals` + `timeline` + `models` + `sessions` + `resources` + `storage` + `cleanup` |
| `/dsh-usage-stats/cleanup` | GET | 只要磁盘与清理计划的 dry run |
| `/dsh-usage-stats/cleanup` | POST | 按 `{ "ids": [...], "confirm": true }` 删除；不接受未确认的请求 |

- `days` 省略时按 `7`；`0` 表示全部时间；更大的值截断到 `3660`。
- 只接受回环调用：peer 地址、`Host` 头、以及存在时的 `Origin` 头都必须是回环，否则 403。
- POST 只收 JSON，体积上限 256 KB，一次最多 500 个 id。
- 第一次读取请求才懒启动首次扫描：从不打开面板的 profile 不产生索引开销。

## 数据与隐私

- **只读会话日志**：Token 与成本来自 `assistant/message.usage` 事件；插件通过 `sessionPersistence` / `sessionQuery` / `sessions` 这些公开服务读取，不自己解析日志格式。唯一会写会话目录的路径是「可回收空间」里你确认过的删除。
- **资源数字**：Host 的 CPU / 内存来自 Node 的 `process.cpuUsage()` / `process.memoryUsage()`；系统内存来自 `os`；整应用内存来自 Windows 的 `tasklist`（只读一次进程列表，30 秒最多一次）。其它平台或拿不到时，面板退化成 Host 进程的数字并注明。
- **本地缓存**：只存每个会话的 Token 计数、按模型 / 按天的分桶、标题和最近活动时间这些元数据，不存对话正文；每个会话几百字节。删掉它只会让下次打开重新扫描。
- **不联网**：没有网络请求、没有遥测，唯一对外的是本机回环上的两个只读 / 显式确认接口。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半：索引会话日志、折叠摘要、算成本、采样资源、出两个回环 HTTP 路由 |
| `storage.js` | 磁盘树测量、清理计划选择、受控删除 |
| `resources.js` | CPU / 内存采样（Host 进程、整应用、系统） |
| `client.js` | 浏览器半：侧栏入口与面板（手写源码，无需构建） |
| `test/host.test.mjs` | Host 半的隔离测试（临时 DSH_HOME，不碰真实数据） |
| `cordis.patch.yml` | 组合补丁：向 profile 插入 `usage-stats` 这一行 |
| `package.json` | 包声明：`dsh.bundle.patch` 与客户端注入配置 |
| `locale/zh.json`、`locale/en.json` | 插件管理页显示的中 / 英文标题与描述 |
| `icon.svg` | 插件图标 |
| `API.md` | 路由的 JSON 契约 |
| `README.md` | 本文件 |

## 工作原理

- **Host 半**把每个已存会话折叠成一份小摘要（Token、成本、按模型与按天的分桶）；摘要按持久化 revision 缓存在内存和 `summaries.json` 里，重启后先用缓存出数，再只重读变化过的会话。运行中的会话从内存 `sessions` 里增量折叠，所以轮询只花在新事件上。
- **磁盘部分**每隔 15 秒量一次：会话根目录取自持久化后端报告的第一个日志路径（回退到 `$DSH_HOME/sessions`），逐个会话目录求和；附件、域存储、缓存三个目录单独求和。
- **清理计划**把这份扫描结果与工作区注册表的 `archivedSessionIds`、当前运行中的会话 id 做集合运算，得到一个纯函数的候选表；面板只负责显示与勾选。
- **浏览器半**是普通的 DSH 客户端插件：向 `sidebar.panellist` 注册入口，向 `main` 注册同 id 的页面；它只 `fetch` 同源路由，自己不读日志、不碰文件。

## 已知限制

- **首次扫描慢**：空缓存时要读完整份日志，几百个会话需要几十秒；面板会显示进度。
- **整应用内存只有 Windows 有**：Electron 没有给插件暴露进程树 API，这里用 `tasklist` 近似；其它平台只报 Host 进程。
- **CPU 是自采样区间值**：两次轮询之间 Host 进程的平均占用，不和系统性能计数器对齐；面板同时给出单核与整机两个口径。
- **成本只是估算**：按配置的单价表计算，不等于供应商账单；价目表过期也会让估算偏。
- **Token 是供应商上报值**：没上报 usage 的失败调用不计入。
- **只统计本机**：只算这个 profile 能访问到的本机会话日志与 `$DSH_HOME` 目录。
- **会话列表有上限**：用量列表最多 100 个、清理清单最多 200 个，其余仍计入合计。
- **删除不可撤销**：没有回收站；确认前请用「下载会话日志」导出需要保留的会话。

## 兼容性

- 实测环境：DSH Desktop，Windows 11。Host 半依赖 `webServer`、`sessions`、`sessionPersistence`（旧格式日志回退到 `sessionQuery`）；清理依赖 `workspaceRegistry.archivedSessionIds`，缺失时退化为「没有可回收会话」。浏览器半依赖 `sidebar.panellist`、`main` 插槽与 `locale` 服务。
- 插件无第三方依赖、无构建步骤；`node --check index.js`、`node --check client.js` 即可做语法检查，`node --test dsh-usage-stats/test/host.test.mjs` 跑 Host 测试。
- 升级后如果面板提示「Host 端还是旧版本」，说明浏览器已经拿到新代码而 DSH 进程还是旧的：重启 DSH 即可。

## 卸载与数据清理

1. DSH Desktop → **插件** → **已安装插件** → 关闭开关或点卸载（CLI profile 用 `dsh plugin --profile <profile> remove @local/dsh-usage-stats`）。
2. 关闭或卸载后侧栏入口与面板消失，Host 不再注册路由；重启 DSH 后彻底释放。
3. 删除统计缓存（可选，不影响任何会话数据）：

   ```powershell
   Remove-Item -Recurse -Force "$env:USERPROFILE\.dsh\cache\dsh-usage-stats"
   ```

4. 插件不使用 `localStorage`，没有其他浏览器数据需要清理；会话日志不属于插件数据，已删除的日志无法由卸载恢复。

## 许可证

[MIT](../LICENSE) © 2026 stuPETER12138

---

更多插件：[返回仓库根 README](../README.md) · 安装与排错：[docs/INSTALL.md](../docs/INSTALL.md)
