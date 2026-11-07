# DSH Session Share — browser export core

`src/export-core.js` is a dependency-free browser chunk. `client.js` inlines its
text inside the plugin factory, so the file declares exactly one top-level
symbol: `function createExportCore()`. It never touches `document`, `canvas`,
`Blob` or `URL` while being evaluated — only when a returned method is called.

## Usage

```js
// client.js inlines src/export-core.js and calls the factory once:
const core = createExportCore();

// `view` is assembled host-side (see host/index.js contract):
const view = {
  session: { id, title, cwd, createdAt, updatedAt, model },
  items: [{
    id, kind: 'user' | 'assistant' | 'tool' | 'note', seq, time,
    text, images, model, toolCalls: [{ name, title, detail, status }]
  }]
};

// Markdown (synchronous)
const md = core.serializeMarkdown(view, { includeToolCalls: true, includeTimestamps: true });
core.download(new Blob([md], { type: 'text/markdown;charset=utf-8' }), baseName + '.md');

// PNG (one tall image)
const png = await core.renderImage(view, { title, generatedAt: Date.now() });
core.download(png.blob, baseName + '.png');   // png = { blob, width, height, scaled }

// PDF (A4 portrait, one image per page)
const pdf = await core.renderPdf(view, { title, generatedAt: Date.now() });
core.download(pdf.blob, baseName + '.pdf');   // pdf = { blob, pages }
```

## API

### `serializeMarkdown(view, options?) -> string`
Produces plain markdown:
`# <title>`, a `>` metadata line (cwd / export time / message count / model),
then per item `### 你` / `### 助手` / `### 工具` / `### 备注`, an optional
`*时间：...*` line, the item text verbatim (it is already markdown), an optional
`*图片：N 张*` line and optional `- 工具调用：...` bullets, ending with
`— 由 DSH 会话分享导出`. Empty views and empty item text are handled.

### `renderImage(view, options?) -> Promise<{ blob, width, height, scaled }>`
900 CSS px wide share card (44 px padding, white background), rendered at
pixel scale 2 (1800 px wide) while the CSS height stays <= 8000 px. Longer
documents are re-laid out with a visible "内容较长…已自动缩放" banner and scaled
so the pixel height is <= 16000. `scaled` reports whether the scale went below 2.
`width`/`height` are pixel dimensions of the PNG.

### `renderPdf(view, options?) -> Promise<{ blob, pages }>`
A4 portrait (595.28 x 841.89 pt), 48 pt margins, layout runs at the A4 content
width (499.28 pt) and flows across pages; nothing is repeated except a small
per-page footer (`DSH 会话分享 · <title>` on the left, `第 n / N 页` on the
right). Each page is rasterised to a 1240 x 1754 canvas (scale ~2.083) and
encoded as JPEG (quality 0.9); the PDF embeds those JPEGs with `/DCTDecode`.

### `download(blob, filename) -> void`
Sanitises the filename (strips `\\ / : * ? " < > |` and control chars, trims,
caps at 120 chars, falls back to `dsh-session-share`), creates an object URL,
appends a hidden `<a download>`, clicks it, then removes the anchor and revokes
the URL from a `setTimeout` (~4 s).

### `view`
| field | meaning |
| --- | --- |
| `session.id/title/cwd/createdAt/updatedAt/model` | header + metadata; `title` may be overridden by `options.title` |
| `items[].kind` | `user` / `assistant` / `tool` / `note` (unknown kinds render as 消息) |
| `items[].text` | markdown source, rendered verbatim in markdown export and through the canvas markdown subset |
| `items[].time` | epoch ms/s, ISO string or Date; shown when `includeTimestamps !== false` |
| `items[].images` | a count (number, the Host payload shape) or an array; only its count is reported (`图片 N 张`) |
| `items[].imageRefs` | `[{ attachmentId, mediaType, width, height, bytes?, name? }]`; resolved through `view.attachments` and drawn into PNG/PDF |
| `view.attachments` | `{ [attachmentId]: { mediaType, width, height, bytes, dataUrl } }` — Host-resolved `data:` URLs; a missing entry/undecodable image is skipped |
| `items[].model` | per-message model, shown next to the assistant chip |
| `items[].toolCalls` | `[{ name, title, detail?, status? }]`, rendered as ▸ bullets when `includeToolCalls !== false` |

### `options`
`title`, `includeToolCalls` (default `true`), `includeTimestamps` (default
`true`), `generatedAt` (epoch ms; export time, defaults to session
`updatedAt`/`createdAt`/now).

## Design

- One layout engine (`layoutDocument`) emits an ordered list of paint ops
  (rects and text runs) in CSS px / PDF points. `renderImage` paints them into
  one tall canvas; `renderPdf` slices them at op boundaries into pages, so a
  line is never cut in half at a page break. Both share the same styles.
- Markdown subset for canvas: fenced code blocks, `#`..`######` headings,
  bullet/numbered lists, blockquotes, horizontal rules, paragraphs, and pipe
  tables. Tables get proportional column widths fitted to the content width,
  per-column alignment, shaded header row, row separators, and wrapped cell
  text with inline markdown (no longer monospace preformatted lines). Inline:
  `**bold**`, `*italic*`, `` `code` ``, `[text](url)` (text only),
  `![alt](url)` → `[图片: alt]`, `~~strike~~`. No nested inline styling, no
  HTML, no remote image loading.
- Message images are decoded from `data:` URLs (`document.createElement('img')`
  with the source assigned **before** `decode()`, then `onload`/`decode` resolve)
  before layout, then drawn as image ops
  scaled to the content width with a maximum height (PDF uses 70% of the page
  content height). An image that fails to decode is skipped; the share still
  exports. PNG draws them directly, PDF rasterizes them with the page.
- Wrapping is CJK-aware: every CJK glyph is its own break opportunity, latin
  words stay intact (over-long words are hard-broken), and widths come from
  `ctx.measureText` (memoised per font+text).
- PDF is written by hand: `%PDF-1.4`, `/Catalog`, `/Pages`, three objects per
  page (`/Page`, content stream, `/XObject` `/Image` with `/DCTDecode`), an
  `/Info` object with `/Producer` and `/CreationDate`, then an xref table built
  from recorded absolute offsets and a trailer with `/Size`, `/Root`, `/Info`.
  Every `/Length` is the exact byte count between `stream\n` and `\nendstream`.
  The file is ASCII except the embedded JPEG bytes.
- All canvases are reset to `width = height = 0` as soon as their blob is
  produced.

## Limits / known constraints

- PNG: pixel height is capped at 16000 px; content that would need a scale below
  0.2 is still clamped there (only absurdly long sessions reach that), so the
  hard browser limit always wins over the nominal 0.5 floor.
- PDF: content is raster, not selectable text (by design of the spec). A very
  long session produces one JPEG per page; pages are rendered sequentially and
  released immediately to bound memory.
- Item images are not embedded in PNG/PDF (only counted); markdown keeps the
  original markdown image syntax.
- Table rendering is monospace preformatted text; wide tables wrap by
  character.
- The engine is synchronous in markdown export and promise-based in image/PDF
  export; it does not read the DOM, so it can also be unit-tested in node
  (`tools/test-export-core.mjs`).

## Testing

```powershell
cd plugins\dsh-session-share
& 'C:\Users\WU\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe' tools\test-export-core.mjs
```

The test stubs `document`/canvas/`Blob`/`URL`, evaluates the chunk with
`new Function` (asserting no top-level DOM access), checks markdown output, PNG
dimensions and scale behaviour, and parses the generated PDF structurally
(header/EOF, page count, exact `/Length`, xref offsets pointing at `N 0 obj`,
trailer `/Size` `/Root` `/Info`, `/DCTDecode` image streams). It prints
`PASS`/`FAIL` per assertion and exits non-zero on failure.
