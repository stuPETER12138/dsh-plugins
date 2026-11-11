# DSH Session Share — LaTeX math support (0.2.0)

> 设计说明。实现与测试以 `src/latex.js`、`src/export-core.js`、`tools/test-latex.mjs`、
> `tools/test-export-core.mjs` 为准。

## 目标与范围

导出的 PNG / PDF 里，对话中的 LaTeX 公式要像 DSH 聊天里一样排版，而不是显示原始
`$...$` 文本。约束沿用仓库约定：**无第三方依赖、不联网、不加载 CDN/远程字体、纯浏览器**；
Markdown 导出永远保留原始 TeX 源码。

分隔符与 DSH 聊天（micromark math 扩展）对齐：

- 行内：`$...$`、`\(...\)`；行内 `$$...$$` 也按行内公式处理（DSH 的 `mathText`）。
- 独立：`$$` 流式块、`\[...\]` 流式块、```` ```math ```` 代码围栏（DSH 会把该围栏渲染成
  display math）。
- 代码 span 内的 `$` 不生效；`\$` 等反斜杠转义保持字面量；`$` 成对但内容为空的视为普通文本。

## 为什么不是 KaTeX / MathJax

DSH 前端本身打包了 KaTeX（`dsh-web-frontend` 里有 KaTeX 字体与 `renderToString`），但：

- 插件的 client 模块只能 `require` 平台模块表里的模块，拿不到前端 bundle 内的 KaTeX 实例；
- KaTeX 输出 HTML，依赖自带的 web 字体；往 canvas 栅格化需要 `foreignObject` + 内联字体，
  体积和可靠性都不可接受；
- 仓库红线是不引入第三方运行时依赖。

所以选择「**TeX 子集 → MathML → 浏览器原生排版 → 栅格化**」：排版质量由 Chromium 的
MathML Core 负责，插件只做语法映射与位图化。

## `src/latex.js` 结构

单一入口 `createLatexEngine()`（普通 chunk，无 import/export；构建时内联进 client.js）：

1. **符号表**：希腊字母、二元/关系/箭头/杂项、大运算符（`sum/prod/int/...`）、极限算子
   （`lim/max/min/...`）、函数名（`sin/cos/log/...`）、重音、定界符、间距、`\not` 组合。
2. **Tokenizer**：记录字符偏移（`\text`、`\begin{...}`、array 列格式按原文切片）；忽略数学模式
   空白与 `%` 注释；区分控制词/控制符、`{}`、`^`、`_`、`&`、`'`、数字、Unicode 码点（含代理对）。
3. **Parser**：递归下降 → 小型 AST：`row/sym/text/func/op/frac/sqrt/script/accent/limits/fence/table/space`。
   - `\frac`、`\sqrt[n]`、`\left...\right`、`\middle`、上/下标（含 `'` 撇号）、`\limits/\nolimits`；
   - `\text`/`\operatorname` 文本模式（保留空格为 NBSP、支持 `~` 与转义）；
   - 样式命令在**解析期**改写字符（见下）；
   - 环境：`matrix/pmatrix/bmatrix/Bmatrix/vmatrix/Vmatrix/smallmatrix/cases/dcases/`
     `aligned/align/split/gather/multline/array`（含 `{lcr}` 列格式），以及
     `equation/displaymath` 等透明包裹。
   - 容错：未知命令 → 可见文本；缺花括号/超长输入不抛异常（`toMathML` 兜底返回 null）。
4. **Serializer**：AST → MathML 字符串（`<math xmlns=...>`）。
   - 大运算符按 display/inline 决定 `munderover` 还是 `msubsup`；`\lim` 等始终放上下限。
   - `\left...\right` → `<mo fence="true" stretchy="true">`；矩阵/`cases` 用 `<mtable>` 包定界符。
   - 重音 `mover/munder accent`；`\overset/\underset` → `mover/munder accent="false"`。
   - XML 转义 + 孤立代理项替换，保证 data URL 可编码。
5. **Rasterizer**（只在调用时碰 DOM）：
   - 画布基准字号 `BASE_FONT = 48`、四周留白 `PAD = 6`；
   - 隐藏容器里放 `<math>` 与 1px `inline-block` 探针，`getBoundingClientRect()` 得到
     `width/height` 以及与正文基线的 `ascent/descent`；
   - 把同一段 MathML 放进 SVG `<foreignObject>`（`display:flex; align-items:flex-start` 保证
     公式左上角就是 `(PAD, PAD)`），`data:image/svg+xml` → `img` → `canvas` 绘制；
   - 顺序处理、单公式 8s 超时，任何失败只丢该公式（调用方回退原文），`rasterize()` 永不 reject；
   - 返回 `Map<key, {canvas, cssW, cssH, ascent, descent, pad, baseFont}>`。

### 样式命令为什么改成 Unicode 字符

实测 Chromium 的 MathML Core **忽略** `mathvariant="double-struck|script|fraktur"` 等值
（`\mathbb{R}` 仍显示斜体 R）。因此 `\mathbb/\mathcal/\mathfrak/\mathbf/\boldsymbol/\mathsf/\mathtt`
在解析期把字母/数字/希腊字母映射到 Unicode 数学字母数字区（如 `ℝ`、`ℒ`、`𝐅`、`𝔤`），
由字体的数学字符回退渲染；`\mathrm` 则把单字母变成直立体 `<mtext>`。普通字母保持 MathML
默认数学斜体。

## 与导出引擎的集成（`src/export-core.js`）

1. **发现公式**：`collectMathSources(view)` 用已有的 `parseMarkdown` / `parseInline` 扫描所选
   消息，收集行内 `math` span 与 `type: 'math'` 块，按 `mathKey = tex + '\0' + display`
   去重（上限 200 个、TeX 长度上限 6000）。
2. **预栅格化**：`renderImage` / `renderPdf` 开头与附件图片并行等待 `loadMathRasters(view)`，
   结果放进 `mode.math`；测试可用 `options.mathRasters` 注入 Map。导出结束（成功或失败）都会
   把公式 canvas 的宽高清零释放内存。
3. **行内公式**：`wrapSpans` 把公式当作**原子盒子**（宽 + 基线上下高度），换行时不可拆分；
   超出整行宽度时等比缩小到行宽。`lineMetrics` 用「默认行高」与「公式 ascent/descent」取大值，
   所以含分式/矩阵的行会自然长高；文本基线仍按原公式计算，未含公式的行完全保持旧版布局。
4. **输出**：`pushLineOps` 为一行生成一个 `text` op（先）+ 若干 `image` op（后，公式位图），
   同一行共享 `group` id；`paginateOps` 只在 group 之间分页，避免「文字在一页、公式在另一页」。
5. **独立公式**：`layoutMathBlock` 按 `MATH_DISPLAY_SIZE = 16` 缩放并水平居中；超宽缩到内容宽度。
6. **回退**：没有 raster 时，行内公式显示原始 `$...$`/`\(...\)` 源文本，独立公式显示 TeX 源文本，
   导出仍成功——`tools/test-export-core.mjs` 用「不能创建 div 的 DOM stub」覆盖此路径。

## 验证

- `node tools/test-latex.mjs`：40 项（转换、环境、样式、转义、超长、无 DOM/敌意 DOM 降级）。
- `node tools/test-export-core.mjs`：88 项（含分隔符解析、DSH 币值误判一致性、公式收集/去重、
  带公式 PNG/PDF、无栅格回退、超宽公式缩放、公式密集分页、canvas 清理）。
- 无头 Chromium 端到端（开发期）：真实 `renderImage`/`renderPdf` 生成 PNG 长图与多页 PDF，
  检查公式基线对齐、表格/列表/引用内的行内公式、```` ```math ```` 的 aligned、跨页不拆行、
  PDF 页脚与页数；另验证内嵌 client.js 在 stub 模块表下可正常执行 factory。

## 已知限制

- 是实用子集而非完整 TeX：`\newcommand`/自定义宏、`\color`、`\tag`、`\overbrace` 的拉伸、
  复杂 `array` 列格式等不保证；未知命令按文本显示。
- 引用块/列表项里的 `$$...$$` 走行内渲染（顶层行才识别 display 块）。
- 公式是位图（PDF 整页也是栅格图），文字不可选中；每份导出对每个不同公式栅格化一次。
- MathML Core 需要 Chromium 109+；更旧的浏览器会走原文回退。
