# 会话分享 · Session Share

在 DSH 里挑当前对话中值得分享的消息，导出成 **PDF / PNG 长图 / Markdown**——表格会排版，用户输入的图片会内嵌，**LaTeX 公式会渲染**，全部在浏览器本机完成，不上传任何内容。

- 包名：`@local/dsh-session-share`
- 版本：`0.2.1`
- 插件形态：Host 半（`index.js`，只读路由）+ Web 客户端（`client.js`，会话页签）
- 入口：会话标题下方的 **分享** 页签（与「对话 / 轨迹 / 统计」并列）
- 适配环境：DSH Desktop `0.2.2-rc.1`，Windows 11 实测
- 数据来源：本机会话（内存中的实时会话 + 已落盘的会话日志），只读
- 网络行为：不联网，导出文件不离开本机
- 许可证：[MIT](../LICENSE)

> 安装 / 升级 / 卸载 / 排错的通用步骤见 [docs/INSTALL.md](../docs/INSTALL.md)；仓库总览与插件清单见[根 README](../README.md)。

## 功能

- **按条选择**：把当前会话拆成一条条「你 / 助手 / 工具调用」条目，每条单独勾选；支持全选、清空，列表上方实时显示已选条数与约多少字。
- **格式与导出在顶部**：Markdown / 图片 / PDF 的格式切换条和下载按钮排在标题下方、消息列表上方，长会话不用滚到底部就能换格式、点导出；导出结果（「已开始下载。共 N 页」或报错）也显示在这条工具栏里。
- **工具调用可选**：默认不显示工具调用；打开「包含工具调用」后，连续的调用会折叠成一条「调用了 N 个工具」摘要并自动加入选择。
- **时间戳可选**：打开「包含时间」后，导出内容会带上每条消息的时间。
- **三种导出格式**：
  - **PDF**（默认）：A4 竖版分页，每页底部有页码与标题页脚；
  - **图片**：一张竖版 PNG 长图，900 CSS px 宽、2 倍像素密度；
  - **Markdown**：复制到剪贴板或下载 `.md`，保留原文的 Markdown 语法。
- **排版能力**：支持标题、段落、列表、引用、代码块、水平线、**管道表格**、行内粗体/斜体/行内代码/链接/删除线；CJK 逐字换行，英文单词不拆断。
- **LaTeX 公式**：行内 `$...$` / `\(...\)` 与独立公式 `$$...$$` / `\[...\]` / ```` ```math ```` 围栏都按 DSH 对话里的同一套分隔符识别，渲染成真正的数学排版（分数、根号、上下标、求和/积分、矩阵、cases、aligned、希腊字母、`\text` 等）；Markdown 导出保留原始 TeX 源码。
- **图片内嵌**：用户消息里的图片会按原始宽高比缩放到内容宽度，画进 PDF / PNG；Markdown 只保留「图片 N 张」提示。
- **纯本机**：浏览器负责选择、排版和生成文件；Host 只提供一个仅回环可访问的只读会话接口，不写任何文件。
- **文件名友好**：下载文件名自动使用「会话标题-{YYYYMMDD-HHmm}.扩展名」，非法字符会被替换。

## 使用

1. 打开任意会话，在标题下方的页签行里点 **分享**。
2. 视图里会列出这个会话可分享的内容：
   - 「你」和「助手」的每条消息都能单独勾选，默认全选；
   - 打开「包含工具调用」后，工具调用摘要作为单独条目出现并自动勾选；
   - 「全选 / 清空」批量操作，「包含时间」控制时间戳；
   - 顶部「刷新」重新读取这个会话的最新消息。
3. 顶部的格式切换条选择 **PDF**（默认）/ **图片** / **Markdown**；Markdown 额外提供「复制 Markdown」。公式不需要额外开关：勾选的消息里只要含 LaTeX，PNG/PDF 就会自动排版（Markdown 保留原始 TeX）。
4. 点顶部右侧的主按钮导出，文件按「会话标题-时间」命名落到浏览器默认下载目录；导出结果显示在同一个工具栏里（PDF 会带上「共 N 页」）。
5. 若提示「历史可能不完整」，稍等片刻再点「刷新」；较长的会话只列最近的部分消息时会显示截断提示。

## 安装

> 通用步骤（含升级、卸载与排错）见 [docs/INSTALL.md](../docs/INSTALL.md)。要点：**每个插件独立安装**；路径必须是**绝对路径**（不能填仓库根目录，也不能是相对路径）；Desktop 的 `desktop` profile 请用插件页安装。

### 方式 B：插件页本地文件夹安装（推荐，离线可用）

1. 获取本仓库（`git clone` 或下载 ZIP 解压），得到插件目录。
2. 打开 DSH Desktop → 左侧栏 **插件** → 右上角 **添加插件**。
3. 填入本插件文件夹本身的绝对路径：

   ```text
   D:\github\dsh-plugins\dsh-session-share
   ```

4. Host 读出包名 / 版本 / 简介后点 **安装**，完成后点 **立即启用**（或之后在「已安装插件」里打开开关）。
5. 一般即时生效；如果会话视图中没有出现「分享」页签，刷新一次页面或重启 DSH Desktop。

### 方式 A：从插件索引安装（需要 GitHub 可达）

前提：插件页有 **发现 / Discover** 标签（没有的话先在 **插件 → 实验性插件** 里启用「自定义插件索引」），且本机能访问 GitHub。

1. **插件** 页 → **发现** 标签 → **添加索引源**。
2. 填入仓库索引地址：

   ```text
   https://raw.githubusercontent.com/stuPETER12138/dsh-plugins/main/index.json
   ```

3. 在列表中找到「会话分享 / Session Share」→ **安装** → **立即启用**。

索引中的版本固定在 GitHub 的具体 commit 上，从仓库子目录安装，不需要手动 clone；没有网络时请改用方式 B。

### 方式 D：命令行（适用于非 Desktop 的 CLI profile）

```powershell
dsh plugin --profile <profile> add "link:D:\github\dsh-plugins\dsh-session-share"
```

DSH `0.2.2` 会在安装依赖后自动把组合包加入 profile 的 `dsh.profile.bundles`，重启该 profile 生效。Desktop 的 `desktop` profile 不建议用 CLI 直接改，交给桌面端插件页管理。

## 安装后确认生效

1. **插件页**：「已安装插件」列表里出现 `@local/dsh-session-share`，开关为开启状态。
2. **会话页签**：打开任意会话，标题下方页签行出现 **分享**；点开能看到「分享当前对话」标题，标题下方是格式切换条与下载按钮，再往下是消息列表。
3. **Host 路由**（可选，排错用）：在浏览器所在端口请求只读接口，应返回 `version: 1` 的 JSON：

   ```powershell
   # 端口以 DSH 实际监听的地址为准（看浏览器地址栏，如 http://127.0.0.1:59739）
   # 把 <session-id> 换成实际会话 id
   Invoke-RestMethod 'http://127.0.0.1:59739/dsh-session-share/transcript?sessionId=<session-id>'
   ```

   不带 `sessionId` 时会取「最近活跃的非子会话实时会话」；找不到会话返回 404 `session-not-found`。
4. **导出自检**：选几条消息，三种格式各导出一次；PDF 应正常分页，PNG 为一张长图，Markdown 可复制可下载。
5. 以上任一环节异常时，先刷新页面；仍异常则检查插件是否真的启用、Host 是否加载成功。

## 配置与偏好

这个插件**没有 Host 配置项**（`cordis.patch.yml` 里只插入一行，不读 `config`），也没有设置页；所有可调项都是浏览器端偏好，存在 `localStorage`：

- 键名：`dsh.session-share.prefs.v1`
- 内容（JSON）：`{ "version": 2, "format": "pdf", "includeTools": false, "includeTimes": false }`
- 各项含义：
  - `format`：`pdf`（默认）/ `image` / `md`；
  - `includeTools`：是否显示并导出工具调用，默认 `false`；
  - `includeTimes`：是否在导出内容中带时间戳，默认 `false`。
- 偏好 v2 起格式默认是 PDF；旧版本（prefs v1）保存的 `format` 不会被采用，统一回落到 PDF，用户切换一次格式后就会写入 v2 新偏好。
- **选择本身（勾选了哪些消息）不持久化**：每次打开或刷新页签都会重新读取会话并默认全选非工具条目。
- 重置偏好：浏览器开发者工具 → Application/存储 → Local Storage → 删除 `dsh.session-share.prefs.v1`，或执行 `localStorage.removeItem('dsh.session-share.prefs.v1')` 后刷新页面。

## 数据与隐私

- **只读会话**：浏览器端不解析会话日志。Host 通过 `sessionQuery` / 内存 `sessions` / `sessionPersistence` 读取本机当前会话，折叠成分享载荷；路由不写文件、不修改会话。
- **仅回环可访问**：接口同时校验 peer 地址、`Host` 头与存在的 `Origin` 头，必须是本机回环；响应带 `cache-control: no-store`，非回环请求返回 403。
- **不联网**：没有遥测、没有 CDN、没有第三方脚本；插件的全部代码随包分发，导出全程在浏览器本机完成。
- **导出文件**：只通过浏览器 `Blob` + 隐藏 `<a download>` 下载到本机（或写入剪贴板），不经过 Host，不上传。
- **图片内嵌有上限**：一次分享最多内嵌 **24 张**用户输入图片，原始字节合计最多 **8 MB**；图片从 DSH 附件存储读取成 `data:` URL 放进内存，不落盘。读取失败或已缺失的图片会被跳过，分享本身不会失败。
- **公式渲染不联网**：LaTeX 由插件自带代码（`src/latex.js`，无第三方库）转成 MathML，再交给浏览器内嵌的数学排版引擎测量、栅格化；不加载 CDN、不下载数学字体、不请求任何远程资源。
- **不导出内部数据**：系统提示、注入上下文、推理过程、压缩记录等内部事件不会出现在导出里。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半：注册只读路由，读取实时/已存会话，回环鉴权与错误响应 |
| `src/transcript.js` | Host 半纯函数：会话事件 → 分享载荷（可单测，无 Node API） |
| `src/export-core.js` | 浏览器纯函数：Markdown 序列化、LaTeX 分隔符解析、Canvas 排版、PNG / PDF 生成 |
| `src/latex.js` | 浏览器纯函数：TeX 子集 → MathML 转换 + 公式栅格化（测量、缩放、回退） |
| `src/client-shell.js` | 浏览器 UI：`conversation.view` 页签的注册与全部交互 |
| `client.js` | **生成文件**（约 162 KB）：`tools/build-client.mjs` 把上面三个 `src/` 模块内联进模块工厂 |
| `tools/build-client.mjs` | 唯一的构建步骤：生成 `client.js` 并校验源文件结构 |
| `tools/test-transcript.mjs` | 折叠逻辑单元测试（含真实会话日志可选用例） |
| `tools/test-export-core.mjs` | Markdown / 排版 / LaTeX 解析 / PNG / PDF 结构测试（stub DOM） |
| `tools/test-latex.mjs` | TeX → MathML 转换与栅格化降级测试 |
| `tools/test-host.mjs` | Host 路由测试（stub Cordis 服务与请求/响应） |
| `notes/transcript.md`、`notes/export-core.md`、`notes/latex.md` | 开发期的调研笔记与设计说明 |
| `cordis.patch.yml` | 组合补丁：向 profile 插入 `session-share` 这一行 |
| `package.json` | 包声明：`dsh.bundle.patch` 与客户端注入配置 |
| `locale/zh.json`、`locale/en.json` | 插件管理页显示的中/英文标题与描述 |
| `icon.svg` | 插件图标 |
| `README.md` | 本文件 |

## 工作原理

### 架构：Host 只读路由 + 浏览器排版引擎

1. 浏览器半注册 `conversation.view` 页签（`id: share`，`order: 50`）；Conversation 外壳会列出该插槽的所有占用者作为页签，并把选中的那个渲染到视图区。
2. 页签打开时向 Host 请求当前会话：

   ```text
   GET /dsh-session-share/transcript?sessionId=<id>
   ```

3. Host 用 `src/transcript.js` 把会话事件折叠成载荷；图片附件由 `ctx.attachments.readImage()` 解析成 `data:` URL 放进 `attachments` 映射。
4. 浏览器用 `src/export-core.js` 完成选择后的排版与导出——`client.js` 是这两个模块内联生成的产物。
5. 载荷版本为 `1`：`{ version, source, truncated, partial, session, items, attachments }`；`source` 标记会话读取路径（`query` / `live` / `persistence` / `merged`）。

### 会话读取顺序

- **实时优先**：先尝试 `sessionQuery.readSession()`（live-preferred，但返回完整逻辑日志）；再退回内存中的 `sessions` 会话（可能只有最近的事件窗口）。
- **落盘补齐**：内存窗口不是从 `seq = 0` 开始时，再读 `sessionPersistence` 的落盘日志，并按绝对 `seq` 合并两边事件，保证分享包含全部轮次。
- **不完整提示**：两边都拿不到完整历史时，载荷带 `partial: true`，界面显示「历史可能不完整」。
- **继承前缀不跳过**：seeded / fork 会话的继承事件（`session/end-seed` 等）属于 Chat 里可见的历史，分享时保留。
- **无 id 兜底**：不带 `sessionId` 时取最近活跃的、非子会话（`origin !== 'subagent'`）的实时会话。
- **上限**：单次最多折叠 20,000 个事件（超过时丢弃更老的并在载荷标 `truncated: true`，界面显示截断提示）；每条消息文本最多 200,000 字符；读取落盘日志超时 20 秒。

### 折叠规则（`src/transcript.js`）

| 会话事件 | 处理方式 |
| --- | --- |
| `user/message` | 只保留 `source.kind === 'user'` 的真实用户输入；注入上下文（`runtime-context`、`skill-catalog`、`time-context`、`agent-message`、`subagent-settled`、`compact-checkpoint` 等）跳过；保留文本与图片引用 |
| `assistant/message` | 只保留有非空文本的回复；推理（reasoning）与纯工具调用步骤不显示；记录模型 / 提供方 |
| `tool/call` + `tool/result` | 按连续工具活动分组成一条「调用了 N 个工具」条目；`tool/result` 的 `isError` / `data.error` 映射为 `ok` / `error` 状态 |
| `session/title` | 取最后一个非空标题；没有再回退到会话头部的 `title` |

- 只保留 append 来源的 surface 事件：模型专用的 `replace` 副本不会进入分享。
- 压缩（compaction）不重放：压缩前的原始消息仍在，注入的 `compact-checkpoint` 消息被跳过。
- 每条事件都包在 `try/catch` 里，脏数据不会让整次分享失败。

### 导出引擎（`src/export-core.js`）

- **Markdown**：直接拼接 `# 标题`、`> 工作目录 / 导出时间 / 消息数 / 模型` 元数据行、逐条 `### 你 / 助手 / 工具`、可选时间与工具调用列表，结尾是导出标记；文本按原文输出。
- **排版中间层**：把 Markdown 子集解析成块（段落、标题、列表、引用、代码块、水平线、管道表格），由一个排版引擎生成「矩形 + 文本段」的绘制指令；PNG 与 PDF 复用同一套排版。
- **表格**：按内容测量分配列宽，支持列对齐、表头底色、行分隔线与单元格内行内 Markdown 换行。
- **LaTeX 公式**：先把对话里的数学分隔符（与 DSH 聊天一致：`$...$`、`\(...\)`、`$$...$$`、`\[...\]`、```` ```math ```` 围栏）解析成 TeX 子集 AST，再转换成 MathML 交给浏览器原生排版；公式在隐藏容器里测量尺寸后，经 SVG `<foreignObject>` 栅格化成位图，作为「带基线信息的行内/块级盒子」参与排版。位图按所在正文/标题字号等比缩放，超宽的行内公式会自动缩小；转换失败、命令不受支持或浏览器没有 MathML 时，自动回退为显示原始 TeX，绝不会因此中断导出。
- **图片**：`data:` URL 先解码成 `Image`，再按内容宽度等比缩放绘制；解码失败就跳过该图，不阻塞导出。
- **PNG**：900 CSS px 宽、2 倍像素密度（约 1800 px 宽），内容最高 8000 CSS px；超长内容会整体缩小、按像素高度不超过 16000 px 控制（缩放下限 0.2 倍），界面提示「图片已按比例缩小」。
- **PDF**：A4 竖版（595.28 × 841.89 pt，48 pt 边距），每页先栅格化为 1240 × 1754 的 Canvas、再编码为 JPEG（质量 0.9）；PDF 由手写写入器封装（`%PDF-1.4`、精确 `/Length`、xref 表、`/DCTDecode` 图片流），每页底部有「DSH 会话分享 · 标题」和「第 n / N 页」。
- 全部零第三方依赖：不引用 CDN、不加载远程字体、不使用第三方打包器；Markdown 导出同步完成，图片/PDF 导出返回 Promise。

### 构建

`client.js` 是**生成文件**，不要直接编辑。修改浏览器代码后：

```powershell
node tools/build-client.mjs   # 把 src/latex.js + src/export-core.js + src/client-shell.js 内联进 client.js
node --check client.js        # 语法检查生成结果
```

构建脚本会校验 `src/latex.js` 必须定义 `createLatexEngine()`、`src/export-core.js` 必须定义 `createExportCore()`、`src/client-shell.js` 必须定义 `inject` 与 `apply`，并拒绝已包含 `__ModuleLoader__` 的片源。仓库已提交构建好的 `client.js`，所以从仓库安装不需要执行构建。

## 开发与测试

四个测试都不依赖浏览器/DOM（`test-export-core.mjs` 会 stub `document` / canvas / `Blob` / `URL`，`test-latex.mjs` 用敌意 DOM stub 验证降级路径），可直接用 Node 运行：

```powershell
cd D:\github\dsh-plugins\dsh-session-share
node tools/test-transcript.mjs    # 事件折叠（含真实会话日志用例，读不到时 SKIP）
node tools/test-export-core.mjs   # Markdown 输出、LaTeX 分隔符/公式收集、PNG 尺寸/缩放、PDF 结构
node tools/test-latex.mjs         # TeX → MathML 转换、样式/环境覆盖、栅格化失败降级
node tools/test-host.mjs          # Host 路由：载荷、404/405、非回环 403、合并与图片
```

当前版本在本机（DSH Desktop `0.2.2-rc.1`，2026-11-09）实测：**四个测试共 176 项断言全部通过**（transcript 16、export-core 88、latex 40、host 32），均以 `SUMMARY` / `passed, failed` 汇总，失败时退出码非 0。另外用无头 Chromium 跑了真实导出端到端验证：含行内/独立公式、矩阵、cases、aligned、表格与代码块的会话可正常生成 PNG 长图与 2 页 PDF，公式按正文基线对齐、跨页不拆行。

- `tools/test-transcript.mjs` 会挑选 `$DSH_HOME/sessions` 下最新的可读日志做一次真实折叠；没有日志的机器会优雅 SKIP 而不是失败。
- 开发笔记在 `notes/`（事件词表、折叠规则、导出 API 与设计取舍），改代码前建议先读；仓库级开发约定见 [docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md)。
- 仓库无 `node_modules`、无 `pnpm install` 需求、无 TypeScript 编译；Node 仅用于构建与测试，运行时全部在 DSH 里。

## 卸载与数据清理

1. 关闭并卸载：DSH Desktop → **插件** → **已安装插件** → 关闭开关或点卸载（CLI profile 用 `dsh plugin --profile <profile> remove @local/dsh-session-share`）。
2. 停用后：会话视图里的「分享」页签与插件样式会随插件 fiber 一起移除；Host 路由不再注册。
3. 清理浏览器偏好（可选）：删除 `localStorage` 键 `dsh.session-share.prefs.v1`。
4. 已经导出到下载目录的 PDF / PNG / Markdown 文件不会被卸载流程删除，需要自行清理。
5. 本插件不在 `$DSH_HOME` 下写任何缓存或数据文件，也没有其他需要清理的 Host 状态。

## 已知限制

- **只分享「会话里实际发生的内容」**：系统提示、推理过程、压缩记录等内部事件不会出现；工具调用以摘要条目呈现，不含完整结果文本。
- **图片范围**：只内嵌**用户输入图片**（助手目前不产出图片），且只进 PDF / 图片；Markdown 保留文字与图片数量，不含图片数据。
- **图片体积上限**：单次最多 24 张 / 8 MB 原始字节；超限或存储已缺失的图片只显示数量提示，不阻塞导出。
- **LaTeX 是实用子集**：覆盖常见数学写作（分数、根号、上下标、求和/积分、`\left...\right`、矩阵/cases/aligned、希腊字母、常用运算符与 `\text`），但不是完整 TeX：`\newcommand`、自定义宏、`\color`、`\tag` 编号样式等不保证；无法识别的命令会原样显示为文本，不会中断导出。
- **公式是位图**：PNG / PDF 里的公式由浏览器排版后栅格化绘制（PDF 本身也是整页栅格图），公式文字不可选中；不同公式各自栅格化一次，单次分享最多渲染 200 个公式，公式越多导出越慢。
- **独立公式的作用域**：`$$` / `\[` / ```` ```math ```` 围栏的独立排版只在消息顶层行生效；引用块、列表项里的 `$$...$$` 会按行内公式渲染（内容不丢、字号较小）。超宽的行内公式会等比缩小到一行内。
- **超长会话**：单次最多折叠 20,000 个事件，更老的事件会被丢弃并提示截断；PNG 有 16000 px 像素高度上限，极长内容会按比例缩小文字（PDF 不受此限，页数随内容增长）。
- **PDF 是栅格图**：可看可打印但文字不可选中/搜索；这是当前实现为保证中文渲染一致而做的取舍。
- **不完整历史**：极新、尚未落盘的事件通过内存窗口合并；两边都拿不到完整历史时会显示「历史可能不完整，稍后刷新」。
- **会话必须存在且可读**：空白未保存会话没有可分享内容；会话被删除后返回 404。
- **单页面板最多渲染 4000 条消息**：超长会话中更靠后的条目不会显示在列表里；而「默认全选」发生在完整条目集合上，因此这类会话的默认导出可能包含看不见的条目。需要精确控制内容时，先「清空」再手动勾选可见条目。
- **依赖 DSH 的会话事件词表**：折叠逻辑按当前版本的 `user/message`、`assistant/message`、`tool/call`、`tool/result`、`session/title` 实现；DSH 大版本改动事件格式时可能需要同步更新。

## 常见问题

**Q：会话页签行里没有「分享」。**
确认插件页开关已打开，刷新页面；仍没有就重启 DSH Desktop（Host 半代码更迭需要重启才会加载新模块）。若插件页本身显示异常，先核对 DSH 版本是否为 `0.2.2-rc.1`。

**Q：页面提示「历史可能不完整」。**
较早的历史还没从落盘日志加载完，稍等几秒再点「刷新」；运行中的会话产生的极新事件也可能此刻只在内存窗口里。

**Q：导出 PDF / PNG 很慢或像卡住。**
排版与栅格化在浏览器主线程完成，超长会话需要几秒到十几秒，按钮会显示「正在生成…」。可以先减少勾选条目再导出；PDF 页数多时文件也会更大。

**Q：图片没有出现在 PDF / PNG 里。**
只内嵌**用户输入图片**；超过 24 张 / 8 MB 的部分、附件已删除或损坏的图片会被跳过（列表里仍显示数量提示）。Markdown 按设计不内嵌图片。

**Q：导出的 PNG / PDF 里公式还是原始 TeX 文本？**
说明公式没有走渲染：先检查分隔符是否配对（`$...$`、`$$...$$`、`\(...\)`、`\[...\]`）。不支持的 TeX 命令会按原文显示（这是有意的降级，不会让导出失败）；若整条消息都如此，确认 DSH 版本够新——Chromium 109+ 才内置 MathML，`DSH Desktop 0.2.2-rc.1` 满足。Markdown 导出按设计永远保留原始 TeX。

**Q：导出的 Markdown 能直接粘贴到别处吗？**
可以。Markdown 是纯文本（行内图片以「图片 N 张」表示）；需要带图片的成品时用 PNG / PDF。

**Q：升级 DSH 后页签消失或导出报错。**
先看 [docs/COMPATIBILITY.md](../docs/COMPATIBILITY.md) 与 [docs/INSTALL.md](../docs/INSTALL.md)。如果新版本改了会话事件格式或浏览器模块系统，需要更新 `src/transcript.js` / `src/client-shell.js` 并重新构建 `client.js`。

## 兼容性

- 实测环境：**DSH Desktop `0.2.2-rc.1`**，Windows 11，DSH 自带 Node `24.21.0`；插件在本机 `desktop` profile 中已安装并启用（`include:session-share`、`fiberPhase: active`）。
- 本机验证记录（2026-11-09）：四个测试共 176 项断言通过；并用无头 Chromium 对含 LaTeX 的会话跑通 PNG/PDF 端到端导出（公式渲染、基线对齐、跨页不拆行、无公式时回退原文）。`GET /dsh-session-share/transcript`（不带 `sessionId`）返回 `version: 1`、`source: "query"` 的真实会话载荷（标题、cwd、模型、条目与 `attachments` 映射）。
- 公式渲染需要浏览器支持 **MathML Core**（Chromium 109+）和系统数学字体（Windows 为 Cambria Math）；DSH Desktop `0.2.2-rc.1` 内嵌 Chromium 满足。渲染在浏览器本机完成，不联网、不加载 CDN 或远程字体。
- Host 半需要 DSH 的 `webServer` 服务；会话读取优先用 `sessionQuery` / 内存 `sessions`，缺失时回退 `sessionPersistence`；内嵌图片需要可选的 `attachments` 服务。
- 浏览器半依赖 `conversation.view` 插槽与 `locale` 服务，并声明 `immediately: true`；它只要求 Chromium 级别的 Canvas / Blob / Clipboard 能力。
- 更老的 DSH 版本可能缺少上述插槽或服务，未做兼容与测试；升级 DSH 后如页签或导出异常，先查看 [docs/COMPATIBILITY.md](../docs/COMPATIBILITY.md) 与 [docs/INSTALL.md](../docs/INSTALL.md) 的排错章节。
- 插件本身无第三方 npm 依赖，不需要 `pnpm install` 或编译；仓库已包含构建好的 `client.js`。

## 许可证

[MIT](../LICENSE) © 2026 stuPETER12138

---

更多插件：[返回仓库根 README](../README.md) · 安装与排错：[docs/INSTALL.md](../docs/INSTALL.md)
