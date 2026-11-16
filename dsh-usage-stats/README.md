# 用量统计 · Usage Stats

左侧栏里的一张只读面板：这段时间用了多少 Token、折算成多少钱。数字全部来自本机会话日志，不联网、不上传。

- 包名：`@local/dsh-usage-stats`，版本 `2.3.0`
- 形态：Host 半（`index.js`，读日志、算成本、出 JSON）+ Web 客户端（`client.js`，一张面板）
- 数据来源：`$DSH_HOME/sessions` 下的会话日志（只读）
- 本地缓存：`$DSH_HOME/cache/dsh-usage-stats/summaries.json`，删掉只会让下次打开重新扫描
- 许可证：[MIT](../LICENSE)

安装步骤见 [docs/INSTALL.md](../docs/INSTALL.md)，仓库总览见[根 README](../README.md)。

## 面板

打开左侧栏的「用量统计」，一张页面从上到下是：

1. **统计范围**：右上角 30 天 / 90 天 / 全部，默认 90 天；切换后按新范围重新聚合。
2. **概览卡**：左边是 Token 日历，右边是六个数字——Token 用量（附输入 / 输出 / 缓存命中拆分）、预估成本、消息数、会话数、活跃天数、最常用模型。窄屏时上下排列。
3. **Token 日历**：一格一天，一列一周（周一开始），一行一个工作日位置；颜色分四档，按当天用量在区间内的排名分位取色（用量最多的四分之一天最深，像贡献图那样），没有用量的日子是空格。格子随范围放大缩小：列少时 30px，90 天 20px，再长收到 14px 并在卡内横向滚动。鼠标悬停在格子上，浏览器提示里是当天的 Token、成本与消息数。
4. **模型用量**：范围内每个模型的 Token、成本与占比（占比是 Token 占比），按 Token 量从多到少排序；Token 占比不到 1% 的模型折叠成一行「其他」，悬停可以看到具体是哪些模型。不在价目表里的模型会用兜底单价，并在卡片下方注明。
5. **会话用量**：范围内用掉 Token 的会话，按最近活动排序，最多列出最近 100 个；正在运行的会话前面有一个小圆点。

日历的宽度跟着范围走：30 天约 6 列，90 天约 14 列，全部时间从第一天铺到今天。

面板打开时每 5 秒取一次数据；Host 每 15 秒重新枚举一次会话日志，只重读内容变过的那几个，所以数字会跟着新对话往前走。

## 使用

1. 点击左侧栏的 **用量统计**，默认看最近 90 天。
2. 用右上角的分段控件切换 30 天 / 90 天 / 全部时间。
3. 首次打开会先显示「索引中 n/N」，Host 正在把会话日志折叠成摘要；索引完之前也会显示已经算出来的部分。
4. 面板底部注明了数据来源；所有数字都在本机算出来。

## 安装

> 通用步骤（含升级、卸载与排错）见 [docs/INSTALL.md](../docs/INSTALL.md)。要点：**每个插件独立安装**；路径必须是**绝对路径**（不能填仓库根目录，也不能是相对路径）；Desktop 的 `desktop` profile 请在插件页安装。

### 方式 B：插件页本地文件夹安装（推荐，离线可用）

1. 获取本仓库（`git clone` 或下载 ZIP 解压）。
2. 打开 DSH Desktop → 左侧栏 **插件** → 右上角 **添加插件**。
3. 填入本插件文件夹本身的绝对路径，例如 `D:\github\dsh-plugins\dsh-usage-stats`。
4. 确认包名 / 版本 / 简介后点 **安装**，再点 **立即启用**。
5. 左侧栏出现「用量统计」入口；没有的话刷新页面或重启 DSH Desktop。

### 方式 A：从插件索引安装（需要 GitHub 可达）

1. **插件** 页 → **发现** 标签 → **添加索引源**，填入
   `https://raw.githubusercontent.com/stuPETER12138/dsh-plugins/main/index.json`。
2. 找到「用量统计 / Usage Stats」→ **安装** → **立即启用**。

### 方式 D：命令行（非 Desktop 的 CLI profile）

```powershell
dsh plugin --profile <profile> add "link:D:\github\dsh-plugins\dsh-usage-stats"
```

## 安装后确认

1. **插件页**：「已安装插件」里出现 `@local/dsh-usage-stats`，开关是开启状态。
2. **左侧栏**：出现「用量统计」入口，点开后能看到标题、范围控件、六个数字和日历。
3. **Host 路由**（可选，排错用；端口以浏览器地址栏为准）：

   ```powershell
   Invoke-RestMethod 'http://127.0.0.1:59739/dsh-usage-stats?days=7' | Select-Object generatedAt
   ```

4. **缓存落盘**（可选）：索引完成后出现 `$DSH_HOME/cache/dsh-usage-stats/summaries.json`；再次打开面板会直接从它出数。

## 配置

插件开箱即用；`config` 只有两项，写在 profile 的 `cordis.patch.yml` 里 `usage-stats` 那一行（Windows 默认 `C:\Users\<用户名>\.dsh\profiles\desktop\cordis.patch.yml`）：

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
```

- 单价单位是 **USD / 1M Token**；`fallback` 用于价目表里没有的模型，面板会给这些模型加注。
- `prices` 的每一项**整条替换**内置价：写平价格式就四个字段都写全；写峰谷格式（`peak` / `offPeak` 两段）也是每段四个字段。
- 改了价格会改变缓存的价格指纹，下次打开会按新价重算一遍。
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

Host 半只注册一个精确路由，供同源的浏览器半读取；字段说明见同目录 [API.md](API.md)。

| 路由 | 用途 |
| --- | --- |
| `GET /dsh-usage-stats?days=<n>` | 一个范围的完整载荷：`totals` + `timeline` + `models` + `sessions` |

- `days` 省略时按 `7`；`0` 表示全部时间；更大的值截断到 `3660`。
- 只接受回环调用：peer 地址、`Host` 头、以及存在时的 `Origin` 头都必须是回环，否则 403；只接受 `GET`。
- 第一次读取请求才懒启动首次扫描：从不打开面板的 profile 不产生索引开销。

## 数据与隐私

- **只读会话日志**：Token 与成本来自 `assistant/message.usage` 事件；插件通过 `sessionPersistence` / `sessionQuery` / `sessions` 这些公开服务读取，不自己解析日志格式，也不改 `$DSH_HOME/sessions` 里的内容。
- **本地缓存**：只存每个会话的 Token 计数、按模型 / 按天的分桶、标题和最近活动时间这些元数据，不存对话正文；每个会话几百字节。删掉它只会让下次打开重新扫描。
- **不联网**：没有网络请求、没有遥测，唯一对外的是本机回环上的一个只读 JSON 接口。
- **缓存校验**：每条摘要对应会话的持久化 revision，只有 revision 变了才重读那一个会话；价格表变化会让整份缓存失效。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半：索引会话日志、折叠摘要、算成本、一个回环 HTTP 路由 |
| `client.js` | 浏览器半：侧栏入口与面板（手写源码，无需构建） |
| `cordis.patch.yml` | 组合补丁：向 profile 插入 `usage-stats` 这一行 |
| `package.json` | 包声明：`dsh.bundle.patch` 与客户端注入配置 |
| `locale/zh.json`、`locale/en.json` | 插件管理页显示的中 / 英文标题与描述 |
| `icon.svg` | 插件图标 |
| `API.md` | 路由的 JSON 契约 |
| `README.md` | 本文件 |

## 工作原理

- **Host 半**把每个已存会话折叠成一份小摘要（Token、成本、按模型与按天的分桶）；摘要按持久化 revision 缓存在内存和 `summaries.json` 里，重启后先用缓存出数，再只重读变化过的会话。运行中的会话从内存 `sessions` 里增量折叠，所以轮询只花在新事件上。
- **浏览器半**是普通的 DSH 客户端插件：向 `sidebar.panellist` 注册入口，向 `main` 注册同 id 的页面；它只 `fetch` 同源的那个路由，自己不读日志。图表是一排 CSS 柱子，没有图表库。
- 数据量与耗时：冷扫描要解压并解析整份日志（本机 331 个文件约 151 MB），之后每次启动通常只重读 0 个；面板会显示索引进度。

## 已知限制

- **首次扫描慢**：空缓存时要读完整份日志，几百个会话需要几十秒；面板会显示进度。
- **成本只是估算**：按配置的单价表计算，不等于供应商账单；价目表过期也会让估算偏。
- **Token 是供应商上报值**：没上报 usage 的失败调用不计入。
- **峰谷规则不完整**：只按 UTC 工作日建模，不识别中国法定节假日。
- **只统计本机**：只算这个 profile 能访问到的本机会话日志。
- **会话列表有上限**：单个范围最多列出最近 100 个会话，其余仍计入合计；面板会注明。
- **不是资源监控**：只统计 Token 与成本。

## 兼容性

- 实测环境：DSH Desktop，Windows 11。Host 半依赖 `webServer`、`sessions`、`sessionPersistence`（旧格式日志回退到 `sessionQuery`）；浏览器半依赖 `sidebar.panellist`、`main` 插槽与 `locale` 服务。
- 插件无第三方依赖、无构建步骤；`node --check index.js`、`node --check client.js` 即可做语法检查。
- 升级后如果面板提示「Host 端还是旧版本」，说明浏览器已经拿到新代码而 DSH 进程还是旧的：重启 DSH 即可。

## 卸载与数据清理

1. DSH Desktop → **插件** → **已安装插件** → 关闭开关或点卸载（CLI profile 用 `dsh plugin --profile <profile> remove @local/dsh-usage-stats`）。
2. 关闭或卸载后侧栏入口与面板消失，Host 不再注册路由；重启 DSH 后彻底释放。
3. 删除统计缓存（可选，不影响任何会话数据）：

   ```powershell
   Remove-Item -Recurse -Force "$env:USERPROFILE\.dsh\cache\dsh-usage-stats"
   ```

4. 插件不使用 `localStorage`，没有其他浏览器数据需要清理；会话日志不属于插件数据。

## 许可证

[MIT](../LICENSE) © 2026 stuPETER12138

---

更多插件：[返回仓库根 README](../README.md) · 安装与排错：[docs/INSTALL.md](../docs/INSTALL.md)
