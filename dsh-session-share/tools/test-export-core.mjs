/**
 * Node-only test harness for src/export-core.js (the browser export engine).
 *
 * The export core is a plain browser chunk (no imports), so this test:
 *   1. reads the chunk text from disk,
 *   2. evaluates it with `new Function` in a fake scope that stubs
 *      document / Blob / URL / setTimeout (and asserts nothing touches the DOM
 *      at evaluation time),
 *   3. exercises markdown, PNG and PDF export against a stub canvas 2d context,
 *   4. parses the hand-written PDF structurally: %PDF header, /Type /Page
 *      count, DCTDecode image streams with exact /Length, absolute xref offsets
 *      that really point at "N 0 obj", trailer /Size /Root /Info.
 *
 * Run: node tools/test-export-core.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const enginePath = join(here, '..', 'src', 'export-core.js');
const source = readFileSync(enginePath, 'utf8');
const latexPath = join(here, '..', 'src', 'latex.js');
const latexSource = readFileSync(latexPath, 'utf8');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('PASS ' + name);
  } else {
    failed += 1;
    console.log('FAIL ' + name + (detail ? ' :: ' + detail : ''));
  }
}

// ---------------------------------------------------------------------------
// Minimal Blob polyfill: browser Blob is not available in plain node.
// `text()` decodes as latin1 so string offsets stay aligned with byte offsets,
// which is what the PDF structural parser below relies on.
// ---------------------------------------------------------------------------
class FakeBlob {
  constructor(parts, options) {
    options = options || {};
    this.type = options.type || '';
    const buffers = [];
    for (const part of parts || []) {
      if (typeof part === 'string') buffers.push(Buffer.from(part, 'utf8'));
      else if (part instanceof Uint8Array) buffers.push(Buffer.from(part));
      else if (part instanceof ArrayBuffer) buffers.push(Buffer.from(new Uint8Array(part)));
      else if (part && part.buffer instanceof ArrayBuffer) {
        buffers.push(Buffer.from(new Uint8Array(part.buffer, part.byteOffset || 0, part.byteLength)));
      } else {
        buffers.push(Buffer.from(String(part), 'utf8'));
      }
    }
    this._buffer = Buffer.concat(buffers);
    this.size = this._buffer.length;
  }

  arrayBuffer() {
    const out = new ArrayBuffer(this._buffer.length);
    new Uint8Array(out).set(this._buffer);
    return Promise.resolve(out);
  }

  text() {
    return Promise.resolve(this._buffer.toString('latin1'));
  }
}

// ---------------------------------------------------------------------------
// Fake canvas 2d context with a deterministic measureText heuristic:
// CJK glyph = 1em, latin/digits = 0.55em, space = 0.3em.
// ---------------------------------------------------------------------------
const CJK_TEST = /[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/;

function fontSizeOf(font) {
  const match = /(\d+(?:\.\d+)?)px/.exec(String(font || ''));
  return match ? Number(match[1]) : 14;
}

function measureWidthHeuristic(text, size) {
  let width = 0;
  for (const ch of String(text)) {
    if (CJK_TEST.test(ch)) width += size;
    else if (ch === ' ') width += size * 0.3;
    else if (ch === '\t') width += size * 0.6;
    else width += size * 0.55;
  }
  return width;
}

function makeContext(canvas) {
  return {
    canvas: canvas,
    font: '14px sans-serif',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    textBaseline: 'alphabetic',
    textAlign: 'left',
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    rect() {},
    clip() {},
    fill() {},
    stroke() {},
    roundRect() {},
    fillRect() {},
    strokeRect() {},
    clearRect() {},
    fillText() {},
    strokeText() {},
    drawImage() {},
    setTransform() {},
    scale() {},
    translate() {},
    rotate() {},
    measureText(text) {
      return { width: measureWidthHeuristic(text, fontSizeOf(this.font)) };
    }
  };
}

class FakeCanvas {
  constructor() {
    this.width = 0;
    this.height = 0;
    this._context = null;
  }

  getContext(type) {
    if (type !== '2d') return null;
    if (!this._context) this._context = makeContext(this);
    return this._context;
  }

  toBlob(callback, type) {
    const kind = type || 'image/png';
    const payload = kind === 'image/jpeg'
      ? 'FAKE-JPEG-DATA-' + this.width + 'x' + this.height
      : 'FAKE-PNG-DATA-' + this.width + 'x' + this.height;
    callback(new FakeBlob([payload], { type: kind }));
  }

  convertToBlob(options) {
    options = options || {};
    const kind = options.type || 'image/png';
    return Promise.resolve(new FakeBlob(['FAKE-CONVERTED-' + kind], { type: kind }));
  }
}

/** Minimal <img> stand-in: assigning `src` succeeds and reports its size. */
class FakeImage {
  constructor() {
    this.naturalWidth = 640;
    this.naturalHeight = 360;
    this.width = 640;
    this.height = 360;
    this.onload = null;
    this.onerror = null;
    this._src = '';
    this.decodeHasSrc = [];
  }

  get src() {
    return this._src;
  }

  set src(value) {
    this._src = value;
    if (typeof this.onload === 'function') this.onload();
  }

  decode() {
    // Mirrors Chromium: decode() before a source is set rejects.
    const hasSrc = this._src !== '';
    this.decodeHasSrc.push(hasSrc);
    return hasSrc ? Promise.resolve() : Promise.reject(new Error('invalid state'));
  }
}

function createDocumentStub() {
  const canvases = [];
  const images = [];
  const bodyChildren = [];
  const body = {
    appendChild(node) {
      bodyChildren.push(node);
      node.parentNode = body;
      return node;
    },
    removeChild(node) {
      const index = bodyChildren.indexOf(node);
      if (index < 0) throw new Error('removeChild: unknown node');
      bodyChildren.splice(index, 1);
      node.parentNode = null;
      return node;
    }
  };
  return {
    canvases: canvases,
    images: images,
    bodyChildren: bodyChildren,
    body: body,
    documentElement: body,
    createElement(tag) {
      if (tag === 'canvas') {
        const canvas = new FakeCanvas();
        canvases.push(canvas);
        return canvas;
      }
      if (tag === 'a') {
        const anchor = {
          href: '', download: '', rel: '', style: {}, parentNode: null, clicked: false,
          click() { anchor.clicked = true; }
        };
        return anchor;
      }
      if (tag === 'img') {
        const image = new FakeImage();
        images.push(image);
        return image;
      }
      throw new Error('unexpected createElement(' + tag + ')');
    }
  };
}

function createUrlStub() {
  const created = [];
  const revoked = [];
  return {
    created: created,
    revoked: revoked,
    createObjectURL(blob) {
      const url = 'blob:fake/' + created.length;
      created.push({ url: url, blob: blob });
      return url;
    },
    revokeObjectURL(url) {
      revoked.push(url);
    }
  };
}

const timers = [];
function fakeSetTimeout(callback, delay) {
  timers.push({ callback: callback, delay: delay });
  return timers.length;
}
function runTimers() {
  const pending = timers.splice(0, timers.length);
  for (const timer of pending) timer.callback();
}

// ---------------------------------------------------------------------------
// PDF structural parser
// ---------------------------------------------------------------------------
function inspectPdf(text) {
  const report = {
    problems: [],
    pageObjects: 0,
    dctImages: 0,
    streams: 0,
    size: 0,
    xrefEntries: 0,
    xrefChecked: 0
  };

  if (!text.startsWith('%PDF-1.4')) report.problems.push('missing %PDF-1.4 header');
  if (!/%%EOF\s*$/.test(text)) report.problems.push('missing %%EOF');
  if (!/\/MediaBox\s*\[\s*0\s+0\s+595\.28\s+841\.89\s*\]/.test(text)) {
    report.problems.push('bad or missing /MediaBox');
  }

  report.pageObjects = (text.match(/\/Type\s*\/Page(?![s])/g) || []).length;
  report.dctImages = (text.match(/\/DCTDecode/g) || []).length;

  // Every stream: the declared /Length must match the bytes before "\nendstream".
  let searchFrom = 0;
  while (true) {
    const marker = text.indexOf('>>\nstream\n', searchFrom);
    if (marker < 0) break;
    report.streams += 1;
    const dataStart = marker + '>>\nstream\n'.length;
    const dictionary = text.slice(Math.max(0, marker - 400), marker);
    const lengths = Array.from(dictionary.matchAll(/\/Length\s+(\d+)/g));
    if (!lengths.length) {
      report.problems.push('stream #' + report.streams + ' missing /Length');
    } else {
      const length = Number(lengths[lengths.length - 1][1]);
      if (text.slice(dataStart + length, dataStart + length + 10) !== '\nendstream') {
        report.problems.push('stream #' + report.streams + ' /Length ' + length + ' does not match its data');
      }
    }
    searchFrom = dataStart;
  }

  // xref table: absolute offsets must point at "N 0 obj".
  const startxref = /startxref\s+(\d+)\s+%%EOF/.exec(text);
  if (!startxref) {
    report.problems.push('missing startxref');
    return report;
  }
  const xrefStart = Number(startxref[1]);
  if (text.slice(xrefStart, xrefStart + 4) !== 'xref') {
    report.problems.push('startxref does not point at the xref table');
    return report;
  }
  const lines = text.slice(xrefStart).split('\n');
  const header = /^0 (\d+)$/.exec(lines[1] || '');
  if (lines[0] !== 'xref' || !header) {
    report.problems.push('bad xref subsection header');
    return report;
  }
  report.size = Number(header[1]);
  for (let n = 1; n < report.size; n += 1) {
    const entry = lines[2 + n] || '';
    const match = /^(\d{10}) (\d{5}) ([nf]) $/.exec(entry);
    if (!match) {
      report.problems.push('bad xref entry for object ' + n);
      continue;
    }
    if (match[3] === 'n') {
      report.xrefEntries += 1;
      const offset = Number(match[1]);
      const expected = n + ' 0 obj';
      if (text.slice(offset, offset + expected.length) === expected) report.xrefChecked += 1;
      else report.problems.push('xref offset for object ' + n + ' is wrong');
    }
  }

  const trailerIndex = text.indexOf('trailer', xrefStart);
  const trailer = trailerIndex >= 0 ? text.slice(trailerIndex, trailerIndex + 500) : '';
  const sizeMatch = /\/Size\s+(\d+)/.exec(trailer);
  if (!sizeMatch) report.problems.push('trailer missing /Size');
  else if (Number(sizeMatch[1]) !== report.size) report.problems.push('trailer /Size mismatch');
  if (!/\/Root\s+1\s+0\s+R/.test(trailer)) report.problems.push('trailer missing /Root 1 0 R');
  const infoMatch = /\/Info\s+(\d+)\s+0\s+R/.exec(trailer);
  if (!infoMatch) report.problems.push('trailer missing /Info');
  else if (text.indexOf(infoMatch[1] + ' 0 obj') < 0) report.problems.push('trailer /Info object missing');

  return report;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const NOW = Date.UTC(2026, 10, 6, 16, 29, 35);

function makeSampleView() {
  return {
    session: {
      id: 'session-1',
      title: '示例会话标题',
      cwd: 'D:\\work\\demo',
      createdAt: NOW - 3600000,
      updatedAt: NOW,
      model: 'deepseek-v4.1-flash'
    },
    items: [
      {
        id: 'm1', kind: 'user', seq: 1, time: NOW - 300000,
        text: '帮我检查一下这段代码，谢谢！\n\n```js\nconst a = 1;\nconsole.log(a);\n```'
      },
      {
        id: 'm2', kind: 'assistant', seq: 2, time: NOW - 240000,
        model: 'deepseek-v4.1-flash',
        text: '好的，下面是一个列表：\n\n- 第一项\n- 第二项 **加粗** 和 *斜体* 以及 `inline code`\n\n' +
          '1. 有序一\n2. 有序二\n\n> 引用文本\n\n| 列A | 列B |\n| --- | --- |\n| 1 | 2 |\n\n' +
          '[链接](https://example.com) 和 ![截图](https://example.com/a.png) 以及 ~~删除~~',
        toolCalls: [
          { name: 'Read', title: '读取文件', status: 'done' },
          { name: 'Bash', title: '运行测试' }
        ]
      },
      {
        id: 'm3', kind: 'tool', seq: 3, time: NOW - 180000,
        text: '工具输出：全部测试通过。'
      },
      {
        id: 'm4', kind: 'note', seq: 4, time: NOW - 120000,
        text: '备注：这是一条备注。',
        images: [{ src: 'a.png' }, { src: 'b.png' }]
      }
    ]
  };
}

function makeTallView() {
  const items = [];
  for (let i = 0; i < 45; i += 1) {
    items.push({
      id: 'tall-' + i,
      kind: i % 2 ? 'assistant' : 'user',
      seq: i + 1,
      time: NOW - i * 1000,
      text: '第 ' + (i + 1) + ' 条消息。' + '这是一段用于撑高导出图片的中文内容。'.repeat(16) +
        '\n\n```js\nconst value = ' + i + ';\n```'
    });
  }
  return {
    session: { id: 'tall', title: '超长会话测试', cwd: '/tmp/tall', updatedAt: NOW, model: 'deepseek-v4.1-flash' },
    items: items
  };
}

function makeImageSampleView() {
  return {
    session: { id: 'image-sample', title: '图片分享测试', cwd: '/tmp/image', updatedAt: NOW, model: 'deepseek-v4.1-flash' },
    items: [
      {
        id: 'img-1',
        kind: 'user',
        seq: 1,
        time: NOW - 5000,
        text: '看一下这张截图。',
        images: 1,
        imageRefs: [{ attachmentId: 'sha256:image-1', mediaType: 'image/png', width: 640, height: 360 }],
      },
      {
        id: 'img-2',
        kind: 'assistant',
        seq: 2,
        time: NOW - 4000,
        model: 'deepseek-v4.1-flash',
        text: '| 指标 | 值 |\n| --- | --- |\n| 宽 | 640 |\n| 高 | 360 |\n\n表格如上。',
      },
    ],
    attachments: {
      'sha256:image-1': {
        mediaType: 'image/png',
        width: 640,
        height: 360,
        bytes: 4,
        dataUrl: 'data:image/png;base64,AQIDBA==',
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  check('core: chunk has no import/export statements', !/^\s*(import|export)\s/m.test(source));
  check('core: defines top-level function createExportCore()', /^function createExportCore\(\)/m.test(source));
  check('latex: chunk has no import/export statements', !/^\s*(import|export)\s/m.test(latexSource));
  check('latex: defines top-level function createLatexEngine()', /^function createLatexEngine\(\)/m.test(latexSource));

  const factory = new Function('document', 'Blob', 'URL', 'setTimeout',
    latexSource + '\n' + source + '\nreturn createExportCore;');

  // (1) Evaluating the chunk must not touch the DOM.
  let topLevelOk = false;
  try {
    const throwing = new Proxy({}, { get() { throw new Error('top-level DOM access'); } });
    const create = factory(throwing, throwing, throwing, throwing);
    const api = create();
    topLevelOk = typeof api.serializeMarkdown === 'function' &&
      typeof api.renderImage === 'function' &&
      typeof api.renderPdf === 'function' &&
      typeof api.download === 'function';
  } catch (err) {
    topLevelOk = false;
    console.log('   (top-level DOM check error: ' + err.message + ')');
  }
  check('core: no top-level DOM access on eval', topLevelOk);

  const documentStub = createDocumentStub();
  const urlStub = createUrlStub();
  const core = factory(documentStub, FakeBlob, urlStub, fakeSetTimeout)();

  check('core: returns all four API functions',
    typeof core.serializeMarkdown === 'function' &&
    typeof core.renderImage === 'function' &&
    typeof core.renderPdf === 'function' &&
    typeof core.download === 'function');

  // (2) Markdown export.
  const sample = makeSampleView();
  const md = core.serializeMarkdown(sample);
  check('markdown: starts with "# 示例会话标题"', md.startsWith('# 示例会话标题'));
  check('markdown: metadata line has cwd', md.includes('工作目录：`D:\\work\\demo`'));
  check('markdown: metadata line has model', md.includes('deepseek-v4.1-flash'));
  check('markdown: role headings', md.includes('### 你') && md.includes('### 助手') && md.includes('### 工具'));
  check('markdown: user text preserved', md.includes('帮我检查一下这段代码'));
  check('markdown: assistant code block preserved', md.includes('```js') && md.includes('console.log(a);'));
  check('markdown: tool call bullet list', md.includes('- 工具调用：`Read` — 读取文件（done）'));
  check('markdown: images count line', md.includes('*图片：2 张*'));
  check('markdown: timestamp line', /\*时间：/.test(md));
  check('markdown: footer line', md.includes('— 由 DSH 会话分享导出'));

  const mdPlain = core.serializeMarkdown(sample, { includeToolCalls: false, includeTimestamps: false });
  check('markdown: includeToolCalls=false', !mdPlain.includes('工具调用：'));
  check('markdown: includeTimestamps=false', !mdPlain.includes('*时间：'));

  const emptyMd = core.serializeMarkdown({ session: { title: '空会话' }, items: [] });
  check('markdown: empty view', emptyMd.startsWith('# 空会话') && emptyMd.includes('— 由 DSH 会话分享导出'));
  const bareMd = core.serializeMarkdown({ items: [{ kind: 'user', text: '你好' }] });
  check('markdown: fallback title', bareMd.startsWith('# 会话分享'));

  // (2b) LaTeX parsing hooks (inline extraction + display blocks).
  const testApi = core.__test;
  check('math: test hooks exposed', !!testApi &&
    typeof testApi.parseInline === 'function' &&
    typeof testApi.parseMarkdown === 'function' &&
    typeof testApi.collectMathSources === 'function');

  function mathSpans(spans) {
    return spans.filter((span) => span && span.math);
  }

  const inlineMath = testApi.parseInline('应力 $\\sigma = \\frac{F}{A}$ 与 \\(E=mc^2\\)。');
  const inlineMathSpans = mathSpans(inlineMath);
  check('math: $...$ and \\(...\\) extracted as math spans', inlineMathSpans.length === 2,
    JSON.stringify(inlineMathSpans.map((span) => span.math.tex)));
  check('math: inline TeX keeps its content',
    inlineMathSpans.length === 2 && inlineMathSpans[0].math.tex === '\\sigma = \\frac{F}{A}' &&
    inlineMathSpans[1].math.tex === 'E=mc^2',
    JSON.stringify(inlineMathSpans.map((span) => span.math.tex)));
  check('math: text around inline math is preserved',
    inlineMath.some((span) => span.text && span.text.indexOf('应力') >= 0) &&
    inlineMath.some((span) => span.text && span.text.indexOf('与') >= 0));
  check('math: code spans never open math',
    mathSpans(testApi.parseInline('`$x$`')).length === 0);
  check('math: escaped dollars stay literal',
    mathSpans(testApi.parseInline('\\$5 和 \\$6')).length === 0 &&
    testApi.parseInline('\\$5 和 \\$6').map((span) => span.text || '').join('').indexOf('$5 和 $6') >= 0);
  check('math: mid-line $$...$$ is inline math (DSH parity)',
    mathSpans(testApi.parseInline('x $$y$$ z')).length === 1 &&
    mathSpans(testApi.parseInline('x $$y$$ z'))[0].math.tex === 'y');
  check('math: currency-like text matches the DSH tokenizer',
    mathSpans(testApi.parseInline('$5 and $10 元')).length === 1 &&
    mathSpans(testApi.parseInline('$5 and $10 元'))[0].math.tex === '5 and ');
  check('math: math inside bold keeps the bold flag',
    mathSpans(testApi.parseInline('**bold $x$**')).length === 1 &&
    mathSpans(testApi.parseInline('**bold $x$**'))[0].bold === true);

  function mathBlockOf(markdown) {
    return testApi.parseMarkdown(markdown).find((block) => block.type === 'math');
  }
  check('math: multi-line $$ display block',
    !!mathBlockOf('$$\nx^2\n$$') && mathBlockOf('$$\nx^2\n$$').tex === 'x^2' &&
    mathBlockOf('$$\nx^2\n$$').display === true);
  check('math: same-line $$ display block', !!mathBlockOf('$$a$$') && mathBlockOf('$$a$$').tex === 'a');
  check('math: \\[...\\] display block',
    !!mathBlockOf('\\[\n\\frac{a}{b}\n\\]') && mathBlockOf('\\[\n\\frac{a}{b}\n\\]').tex === '\\frac{a}{b}');
  check('math: same-line \\[...\\] display block',
    !!mathBlockOf('\\[ a \\]') && mathBlockOf('\\[ a \\]').tex.trim() === 'a');
  check('math: ```math fence becomes display math',
    !!mathBlockOf('```math\n\\alpha\n```') && mathBlockOf('```math\n\\alpha\n```').tex === '\\alpha');
  check('math: ```latex fence stays a code block',
    testApi.parseMarkdown('```latex\n\\alpha\n```').some((block) => block.type === 'code'));
  check('math: trailing-dollars line is not display math',
    testApi.parseMarkdown('$$a$$$').every((block) => block.type !== 'math'));
  check('math: unterminated $$ is not display math',
    testApi.parseMarkdown('$$\\nunterminated').every((block) => block.type !== 'math'));

  const sourcesView = {
    session: { title: 'sources' },
    items: [
      { kind: 'user', text: '行内 $x^2$ 和 \\(\\alpha\\)' },
      { kind: 'assistant', text: '$$\\int_0^1 x\\,dx$$' },
      { kind: 'assistant', text: '- 列表 $E=mc^2$' },
      { kind: 'assistant', text: '| A | B |\n| --- | --- |\n| $F$ | 2 |' }
    ]
  };
  const collected = testApi.collectMathSources(sourcesView);
  check('math: collectMathSources finds inline, display, list and table math',
    collected.length === 5, 'found=' + collected.length + ' ' + JSON.stringify(collected.map((f) => f.tex)));
  check('math: collectMathSources marks display formulas',
    collected.filter((formula) => formula.display).length === 1,
    JSON.stringify(collected.filter((formula) => formula.display).map((f) => f.tex)));
  check('math: collectMathSources de-duplicates equal formulas',
    testApi.collectMathSources({
      items: [{ text: '$x$ 和 $x$' }, { text: '$x$' }]
    }).length === 1);

  // (3) PNG export.
  const image = await core.renderImage(sample);
  check('image: resolves a blob', image.blob instanceof FakeBlob && image.blob.size > 0);
  check('image: png mime type', image.blob.type === 'image/png');
  check('image: 2x scale for short document', image.width === 1800 && image.scaled === false,
    'width=' + image.width + ' scaled=' + image.scaled);
  check('image: plausible height', image.height > 300 && image.height <= 16000, 'height=' + image.height);
  check('image: all canvases cleaned up',
    documentStub.canvases.length > 0 && documentStub.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));

  const tall = makeTallView();
  const tallImage = await core.renderImage(tall);
  check('image: long document sets scaled=true', tallImage.scaled === true, 'scaled=' + tallImage.scaled);
  check('image: pixel height capped at 16000', tallImage.height <= 16000, 'height=' + tallImage.height);
  check('image: scaled width below 1800', tallImage.width < 1800 && tallImage.width >= 450, 'width=' + tallImage.width);

  // (4) PDF export + structural validation.
  const pdf = await core.renderPdf(sample);
  check('pdf: pages >= 1', pdf.pages >= 1, 'pages=' + pdf.pages);
  check('pdf: blob mime type', pdf.blob.type === 'application/pdf');
  const pdfText = await pdf.blob.text();
  const report = inspectPdf(pdfText);
  check('pdf: starts with %PDF-1.4', pdfText.startsWith('%PDF-1.4'));
  check('pdf: ends with %%EOF', /%%EOF\s*$/.test(pdfText));
  check('pdf: DCTDecode image per page', report.dctImages === pdf.pages,
    'dct=' + report.dctImages + ' pages=' + pdf.pages);
  check('pdf: /Type /Page count matches pages', report.pageObjects === pdf.pages,
    'objects=' + report.pageObjects + ' pages=' + pdf.pages);
  check('pdf: streams have exact /Length', report.streams === pdf.pages * 2,
    'streams=' + report.streams + ' expected=' + pdf.pages * 2);
  check('pdf: structure problems', report.problems.length === 0, report.problems.join('; '));
  check('pdf: xref covers all objects', report.xrefEntries === report.size - 1 && report.xrefChecked === report.size - 1,
    'entries=' + report.xrefEntries + ' checked=' + report.xrefChecked + ' size=' + report.size);

  const tallPdf = await core.renderPdf(tall);
  check('pdf: long document is multi-page', tallPdf.pages > 1, 'pages=' + tallPdf.pages);
  const tallText = await tallPdf.blob.text();
  const tallReport = inspectPdf(tallText);
  check('pdf: long document /Page count', tallReport.pageObjects === tallPdf.pages,
    'objects=' + tallReport.pageObjects + ' pages=' + tallPdf.pages);
  check('pdf: long document xref valid', tallReport.problems.length === 0, tallReport.problems.join('; '));
  check('pdf: long document xref entries', tallReport.xrefChecked === tallReport.size - 1,
    'checked=' + tallReport.xrefChecked + ' size=' + tallReport.size);

  // (5) Embedded message images and a rendered pipe table.
  const imageSample = makeImageSampleView();
  const imageMd = core.serializeMarkdown(imageSample);
  check('markdown: image item keeps its text', imageMd.includes('看一下这张截图。'));
  check('markdown: markdown table source preserved', imageMd.includes('| 指标 | 值 |'));

  const imagePng = await core.renderImage(imageSample);
  check('image: embedded message image exports', imagePng.blob instanceof FakeBlob && imagePng.blob.size > 0);
  check('image: decode() runs only after the source is set',
    documentStub.images.length > 0 && documentStub.images.every((img) => img.decodeHasSrc.every((flag) => flag === true)),
    JSON.stringify(documentStub.images.map((img) => img.decodeHasSrc)));
  check('image: table and image document stays 2x', imagePng.scaled === false && imagePng.width === 1800,
    'width=' + imagePng.width + ' scaled=' + imagePng.scaled);
  check('image: canvases cleaned after image export',
    documentStub.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));

  const imagePdf = await core.renderPdf(imageSample);
  check('pdf: image + table document has pages', imagePdf.pages >= 1, 'pages=' + imagePdf.pages);
  const imagePdfReport = inspectPdf(await imagePdf.blob.text());
  check('pdf: image + table document structure valid', imagePdfReport.problems.length === 0, imagePdfReport.problems.join('; '));

  // A missing attachment must not break the export: the ref is simply skipped.
  const brokenView = makeImageSampleView();
  brokenView.attachments = {};
  const brokenPng = await core.renderImage(brokenView);
  check('image: missing attachment still exports', brokenPng.blob instanceof FakeBlob && brokenPng.width === 1800);

  // (5b) LaTeX export: with a prepared raster map and the raw-TeX fallback.
  function makeFakeMathMap(formulas) {
    const map = new Map();
    for (const formula of formulas) {
      map.set(formula.key, {
        canvas: { fake: 'math-canvas' }, cssW: 90, cssH: 30,
        ascent: 22, descent: 8, pad: 6, baseFont: 48
      });
    }
    return map;
  }

  const mathView = {
    session: { id: 'math', title: '公式测试', cwd: '/tmp/math', updatedAt: NOW, model: 'deepseek-v4.1-flash' },
    items: [
      {
        id: 'math-1', kind: 'user', seq: 1, time: NOW - 9000,
        text: '帮我看看 $\\sigma = \\frac{F}{A}$ 和 \\(E=mc^2\\)。'
      },
      {
        id: 'math-2', kind: 'assistant', seq: 2, time: NOW - 8000, model: 'deepseek-v4.1-flash',
        text: '推导如下：\n\n$$\\int_{0}^{1} x^{2}\\,dx = \\frac{1}{3}$$\n\n' +
          '- 列表公式 $\\sqrt{x^2+y^2}\\le R$\n- 第二项 $\\alpha+\\beta$\n\n' +
          '| 指标 | 公式 |\n| --- | --- |\n| 应力 | $\\sigma$ |\n| 能量 | $E=mc^2$ |\n\n' +
          '```math\n\\begin{aligned}\n\\dot{x} &= Ax + Bu \\\\\ny &= Cx\n\\end{aligned}\n```'
      }
    ]
  };
  const mathFormulas = testApi.collectMathSources(mathView);
  check('math: export view collects formulas (incl. display)',
    mathFormulas.length >= 4 && mathFormulas.some((formula) => formula.display),
    'found=' + mathFormulas.length + ' display=' + mathFormulas.filter((f) => f.display).length);

  const mathPng = await core.renderImage(mathView, { mathRasters: makeFakeMathMap(mathFormulas) });
  check('image: LaTeX view exports a PNG (2x)',
    mathPng.blob instanceof FakeBlob && mathPng.blob.size > 0 &&
    mathPng.width === 1800 && mathPng.height > 300,
    'width=' + mathPng.width + ' height=' + mathPng.height);

  const mathPdf = await core.renderPdf(mathView, { mathRasters: makeFakeMathMap(mathFormulas) });
  check('pdf: LaTeX view has pages', mathPdf.pages >= 1, 'pages=' + mathPdf.pages);
  const mathPdfReport = inspectPdf(await mathPdf.blob.text());
  check('pdf: LaTeX view structure valid', mathPdfReport.problems.length === 0,
    mathPdfReport.problems.join('; '));

  const rawLaTeXMarkdown = core.serializeMarkdown(mathView);
  check('markdown: LaTeX source preserved verbatim',
    rawLaTeXMarkdown.includes('\\sigma = \\frac{F}{A}') &&
    rawLaTeXMarkdown.includes('$$') &&
    rawLaTeXMarkdown.includes('\\begin{aligned}'));

  // Without a DOM layout engine the raster map stays empty; the export must
  // fall back to the raw TeX instead of failing.
  const fallbackPng = await core.renderImage(mathView);
  check('image: LaTeX view exports when rasterisation is unavailable',
    fallbackPng.blob instanceof FakeBlob && fallbackPng.width === 1800);
  const fallbackPdf = await core.renderPdf(mathView);
  check('pdf: raw-TeX fallback structure valid',
    inspectPdf(await fallbackPdf.blob.text()).problems.length === 0);
  check('image: raw-TeX fallback keeps the source visible in the PNG',
    fallbackPng.height !== mathPng.height || fallbackPng.blob.size !== mathPng.blob.size);

  // A formula wider than the content width must be scaled down, not break the
  // layout or push the PNG over its pixel limits.
  const wideView = {
    session: { title: 'wide' },
    items: [{
      kind: 'assistant', seq: 1,
      text: '超长公式：$\\sum_{i=1}^{1000} \\frac{a_i+b_i}{c_i+d_i}$ 结束。'
    }]
  };
  const wideFormulas = testApi.collectMathSources(wideView);
  const wideMap = new Map();
  for (const formula of wideFormulas) {
    wideMap.set(formula.key, {
      canvas: { fake: 'wide' }, cssW: 3000, cssH: 120,
      ascent: 90, descent: 30, pad: 6, baseFont: 48
    });
  }
  const widePng = await core.renderImage(wideView, { mathRasters: wideMap });
  check('image: oversized inline formula is scaled into the card',
    widePng.blob instanceof FakeBlob && widePng.width === 1800);

  // Many math-bearing lines must still paginate correctly.
  const tallMathItems = [];
  for (let i = 0; i < 30; i += 1) {
    tallMathItems.push({
      id: 'tm-' + i, kind: i % 2 ? 'assistant' : 'user', seq: i + 1, time: NOW - i * 1000,
      text: '第 ' + (i + 1) + ' 条：$\\frac{a_{' + i + '}}{b_{' + i + '}}$ 与 $\\sqrt{x^{2}+y^{2}}$ 以及 ' +
        '一段普通中文内容用于撑高。\n\n$$\\sum_{k=1}^{n} k^{2} = \\frac{n(n+1)(2n+1)}{6}$$'
    });
  }
  const tallMathView = {
    session: { id: 'tall-math', title: '公式分页测试', updatedAt: NOW, model: 'deepseek-v4.1-flash' },
    items: tallMathItems
  };
  const tallMathMap = makeFakeMathMap(testApi.collectMathSources(tallMathView));
  const tallMathPdf = await core.renderPdf(tallMathView, { mathRasters: tallMathMap });
  check('pdf: math-heavy view paginates', tallMathPdf.pages > 1, 'pages=' + tallMathPdf.pages);
  const tallMathReport = inspectPdf(await tallMathPdf.blob.text());
  check('pdf: math-heavy pagination structure valid',
    tallMathReport.problems.length === 0 && tallMathReport.pageObjects === tallMathPdf.pages,
    tallMathReport.problems.join('; '));
  check('image: all canvases cleaned after LaTeX exports',
    documentStub.canvases.length > 0 &&
    documentStub.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));

  // (6) Download helper.
  const createdBefore = urlStub.created.length;
  core.download(image.blob, '我的会话/导出?.png');
  check('download: object URL created', urlStub.created.length === createdBefore + 1);
  const anchor = documentStub.bodyChildren[0];
  check('download: anchor attached and clicked', !!anchor && anchor.clicked === true);
  check('download: filename sanitized', !!anchor && anchor.download === '我的会话-导出-.png',
    anchor ? anchor.download : 'no anchor');
  check('download: cleanup timer scheduled', timers.length === 1 && timers[0].delay === 4000);
  runTimers();
  check('download: anchor removed', documentStub.bodyChildren.length === 0);
  check('download: object URL revoked', urlStub.revoked.length === createdBefore + 1);

  console.log('\n' + (failed === 0 ? 'PASS' : 'FAIL') + ': ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.log('FAIL: harness crashed :: ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
