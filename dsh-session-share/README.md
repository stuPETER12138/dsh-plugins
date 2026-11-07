# 会话分享 — `@local/dsh-session-share`

在 DSH Web 里分享当前对话：在「分享」页签里勾选任意消息，导出为
**PDF（默认）**、**PNG 图片** 或 **Markdown**。用户消息里的输入图片会内嵌到
PDF/图片中，对话里的表格会按表格排版。所有内容都在本机生成，不上传任何文字。

## 用起来

1. 打开任意会话，在标题下方的 View 页签行里点 **分享**（和「对话」「轨迹」「统计」并排）。
2. 视图内容（单列窄布局）：
   - 列出这个会话里可分享的内容：
     - 「你」和「助手」的每条消息都能单独勾选；
     - 打开「包含工具调用」后，工具调用摘要会作为单独条目出现并自动勾选；
     - 「全选 / 清空」批量操作，「包含时间」控制是否带时间戳；
     - 顶部「刷新」重新读取这个会话的最新消息。
3. 底部选择格式并导出（默认 **PDF**）：
   - **PDF**：下载 A4 分页 PDF，用户输入图片与表格都内嵌/排版；
   - **图片**：下载一张竖版 PNG 长图，同样内嵌图片与表格；
   - **Markdown**：`复制 Markdown` 或 `下载 .md`（文本原文，图片以数量标注）。
4. 导出文件按「会话标题-时间」命名，落在浏览器默认下载目录。

## 它的数据从哪里来

浏览器端不解析会话日志。Host 端注册一个只读路由：

```
GET /dsh-session-share/transcript?sessionId=<id>
```

- 会话完整历史优先用 `sessionQuery.readSession()`（live-preferred，但返回**完整**
  逻辑日志）；
- 如果内存里只有最近一段事件窗口（较旧的会话按需加载），再用
  `sessionPersistence` 读取落盘日志并与内存尾部按 `seq` 合并，保证分享包含
  所有轮次；两边都拿不到完整历史时会在界面上提示「历史可能不完整」；
- seeded / 分叉会话的继承前缀（`session/end-seed`、`inheritedEventCount`）
  **不会**被跳过——Chat 里能看到的历史，分享里也要有；
- 不带 `sessionId` 时取「最近活跃的实时会话」，作为插槽没有暴露会话 id 时的兜底；
- 路由只接受本机回环请求（同时校验 peer 地址、`Host`、`Origin`），
  `cache-control: no-store`，不写任何文件。

返回的载荷是一份折叠后的对话数据（标题、cwd、模型、消息条目、内嵌图片），
由 `src/transcript.js` 生成；浏览器只负责选择、排版和导出。

用户消息里的图片不在会话日志里，只有附件引用。Host 端用
`ctx.attachments.readImage(ref)` 读取并校验存储的图片字节，转成 `data:` URL
放进载荷的 `attachments` 映射：

- 一次分享最多内嵌 **24 张**图片、原始字节合计 **8 MB**；
- 超过上限或读取失败（附件被删/损坏）的图片会被跳过，分享本身不会失败；
- 内嵌只发生在 PDF/图片导出，Markdown 只保留文字与图片数量提示。

## 导出是怎么实现的

不依赖任何第三方库、CDN 或构建器：

- **Markdown**：`src/export-core.js` 的 `serializeMarkdown()` 直接把所选条目拼成
  标准 Markdown。
- **图片 / PDF**：同一个排版引擎把 Markdown 子集（标题、段落、列表、引用、
  代码块、**表格**、行内粗体/斜体/代码/链接）画到 Canvas 上，CJK 逐字换行；
  - **表格**：解析管道表格，按内容比例分配列宽、按列对齐、单元格内支持行内
    Markdown 与自动换行，表头带底色、行间有分隔线；
  - **图片**：把用户消息里的图片按原始宽高比缩放到内容宽度（有最大高度限制）
    后画入版面；PNG 里直接绘制，PDF 里随每页一起栅格化；
  - 图片：900px 宽的竖版长图，内容过长时整体等比缩小以适配
    Canvas 高度上限；
  - PDF：A4 分页，每页渲染成 JPEG 后由手写的 PDF 写入器封装，无字体嵌入问题，
    中文显示与页面渲染一致。
- 图片和 PDF 使用独立的浅色「分享卡」配色，不跟随 UI 深色主题，便于直接转发。

## 文件结构

| 文件 | 作用 |
|---|---|
| `index.js` | Host 半：注册只读路由，读取实时/已存会话，鉴权与错误响应 |
| `src/transcript.js` | Host 半纯函数：会话事件 → 分享载荷（可单测，无 Node API） |
| `src/export-core.js` | 浏览器纯函数：Markdown 序列化、Canvas 排版、PNG/PDF 生成 |
| `src/client-shell.js` | 浏览器 UI：`conversation.view` 页签（分享视图）的注册与全部交互 |
| `client.js` | **生成文件**：由 `node tools/build-client.mjs` 把上面两个浏览器模块内联进模块工厂 |
| `tools/build-client.mjs` | 生成 `client.js` 的唯一构建步骤 |
| `tools/test-*.mjs` | 不依赖浏览器/DOM 的单元测试（Node 运行） |
| `locale/*.json` | 插件在插件管理页显示的标题与描述 |

修改浏览器代码后必须重新构建：

```powershell
node tools/build-client.mjs
node --check client.js
```

## 验证

```powershell
node tools/test-transcript.mjs   # 会话事件折叠
node tools/test-export-core.mjs  # Markdown / Canvas 排版 / PDF 结构
node tools/test-host.mjs         # Host 路由：载荷、404、非回环 403
```

本机（DSH Desktop，desktop profile）实测结果：

- 三个测试共 102 项断言全部通过（transcript 16、export-core 54、host 32），
  其中 transcript 测试会折叠一份真实会话日志，export-core 覆盖表格排版与
  图片内嵌（含缺失附件兜底、`img.decode()` 顺序），host 测试覆盖完整性合并、
  图片 data URL、兜底、404/405 与非回环 403；
- 插件已安装并启用：Loader 行为 `include:session-share`，
  `@local/dsh-session-share`，`fiberPhase: active`；
- `GET /dsh-session-share/transcript` 返回 200 与当前会话的真实折叠结果
  （标题、cwd、模型、u/a/tool 条目都正确，并带 `attachments` 图片映射）；
- 浏览器 bundle 由 Host 的 `/plugins` 路由按 revision 正常提供
  （HTTP 200，内容含本插件的模块工厂）。
- 未验证项：本会话没有浏览器控制能力，所以「分享」页签出现在页签行、视图内选择、
  三种格式实际下载的视觉/交互效果需要你在页面上确认一次（插件已热更新；若页签未出现，
  刷新一次页面）。

## 已知边界

- 分享的是「会话里实际发生的内容」：系统提示、推理过程、压缩记录等内部事件
  不会出现；工具调用以摘要条目呈现，不含完整结果文本。
- 图片内嵌只针对**用户输入图片**（助手目前不产出图片），且只进 PDF/图片导出；
  Markdown 导出保留文字与图片数量，不含图片数据。
- 图片导出有 Canvas 高度上限：极长会话会按比例缩小文字，仍保留全部所选内容；
  PDF 页数随内容增长，不截断。
- 超过单次内嵌上限（24 张 / 8 MB）或存储已缺失的图片只显示数量提示，不阻塞导出。
- 极新的、尚未落盘的运行中事件通过内存窗口合并进来；若内存窗口与落盘日志
  都无法给出完整历史，界面会显示「历史可能不完整，稍后刷新」的提示。
- 会话必须在本机 DSH 进程里打开或已经保存才能读取；未保存的空白会话没有可分享内容。

## 设计说明

- 入口是 `conversation.view` 列表插槽的一个页签（`id: share`，`order: 50`），
  和「对话 / 轨迹 / 统计」由同一套 View 页签机制渲染：Conversation 外壳列出该
  插槽的全部占用者作为页签，并把选中的那个渲染到 view 区域里。这里不需要注册
  Conversation target 定义，因为分享视图自己读取数据、不参与对话节点装配。
- 颜色只用 `--dsw-alias-*` / `--ds-*` 主题 token，深色模式自动跟随；
  出错时组件只隐藏自身，不会让整个插槽崩掉（所有导出逻辑都有 try/catch）。
- 选择偏好（格式、是否包含工具调用/时间）存 `localStorage`，
  键为 `dsh.session-share.prefs.v1`；prefs 版本 `2` 起格式默认 **PDF**
  （旧版本保存的 Markdown 默认值会被忽略一次）。
