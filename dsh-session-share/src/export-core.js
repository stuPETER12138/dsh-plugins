/**
 * DSH session share - browser export core.
 *
 * This file is a plain chunk: it is inlined into the plugin client factory, so
 * it has no imports/exports and performs no DOM access at evaluation time.
 * The single entry point is createExportCore(); every returned method touches
 * document/canvas/Blob only when it is called.
 *
 * Public API (see notes/export-core.md):
 *   createExportCore() -> {
 *     serializeMarkdown(view, options?) -> string
 *     renderImage(view, options?) -> Promise<{ blob, width, height, scaled }>
 *     renderPdf(view, options?)   -> Promise<{ blob, pages }>
 *     download(blob, filename)    -> void
 *   }
 *
 * view    = { session: { id, title, cwd, createdAt, updatedAt, model },
 *             items: [{ id, kind, seq, time, text, images?, model?, toolCalls? }] }
 * options = { title?, includeToolCalls?, includeTimestamps?, generatedAt? }
 */
function createExportCore() {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  var SANS = '-apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';
  var MONO = '"SFMono-Regular", Consolas, "Liberation Mono", monospace';

  var SIZE = { title: 26, h1: 20, h2: 17, body: 14, meta: 12, code: 12.5 };
  var LINE_HEIGHT = 1.55;

  var COLOR = {
    background: '#FFFFFF',
    text: '#1F2328',
    title: '#111827',
    muted: '#6B7280',
    meta: '#6B7280',
    separator: '#E5E7EB',
    codeText: '#24292F',
    codeBg: '#F6F8FA',
    inlineCodeBg: '#EEF2F6',
    quoteBar: '#D1D5DB'
  };

  var ROLE = {
    user:      { label: '你',   color: '#1D4ED8', chipBg: '#DBEAFE' },
    assistant: { label: '助手', color: '#047857', chipBg: '#D1FAE5' },
    tool:      { label: '工具', color: '#4B5563', chipBg: '#E5E7EB' },
    note:      { label: '备注', color: '#B45309', chipBg: '#FEF3C7' }
  };

  // Image export geometry, in CSS pixels.
  var IMAGE_WIDTH = 900;
  var IMAGE_PAD_X = 44;
  var IMAGE_PAD_Y = 44;
  var IMAGE_CONTENT_WIDTH = IMAGE_WIDTH - IMAGE_PAD_X * 2;
  var IMAGE_MAX_CSS_HEIGHT = 8000;
  var IMAGE_MAX_PIXEL_HEIGHT = 16000;
  var IMAGE_MAX_SCALE = 2;

  // PDF geometry: A4 portrait, layout units are PostScript points.
  var PDF_PAGE_WIDTH = 595.28;
  var PDF_PAGE_HEIGHT = 841.89;
  var PDF_MARGIN = 48;
  var PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
  var PDF_CONTENT_HEIGHT = PDF_PAGE_HEIGHT - PDF_MARGIN * 2;
  var PDF_CANVAS_WIDTH = 1240;
  var PDF_CANVAS_SCALE = PDF_CANVAS_WIDTH / PDF_PAGE_WIDTH; // ~2.083
  var PDF_CANVAS_HEIGHT = Math.round(PDF_PAGE_HEIGHT * PDF_CANVAS_SCALE);
  var PDF_JPEG_QUALITY = 0.9;

  // CJK ranges: line breaks are allowed between any two CJK glyphs.
  var CJK_RE = /[\u2E80-\u2FFF\u3000-\u303F\u3040-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/;

  var dateFormatter = null;
  try {
    if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
      dateFormatter = new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      });
    }
  } catch (err) {
    dateFormatter = null;
  }

  // ---------------------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------------------
  function pad2(value) {
    return value < 10 ? '0' + value : String(value);
  }

  function toDate(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number' && isFinite(value)) {
      // Tolerate epoch seconds as well as milliseconds.
      var date = new Date(value < 1e12 ? value * 1000 : value);
      return isNaN(date.getTime()) ? null : date;
    }
    var parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatDateTime(value) {
    var date = toDate(value);
    if (!date) return '';
    if (dateFormatter) {
      try { return dateFormatter.format(date); } catch (err) { /* fall through */ }
    }
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
      ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
  }

  function resolveTitle(view, options) {
    options = options || {};
    var title = options.title;
    if (!title && view && view.session) title = view.session.title;
    title = String(title == null ? '' : title).replace(/\s+/g, ' ').trim();
    return title || '会话分享';
  }

  function resolveItems(view) {
    return view && Array.isArray(view.items) ? view.items : [];
  }

  function resolveModel(view, items) {
    if (view && view.session && view.session.model) return String(view.session.model);
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].model) return String(items[i].model);
    }
    return '';
  }

  function resolveMetaDate(view, options) {
    if (options && options.generatedAt != null) return options.generatedAt;
    var session = view && view.session ? view.session : {};
    return session.updatedAt || session.createdAt || Date.now();
  }

  function roleLabel(kind) {
    return ROLE[kind] ? ROLE[kind].label : '消息';
  }

  function truncateText(text, max) {
    var value = String(text == null ? '' : text);
    return value.length <= max ? value : value.slice(0, Math.max(1, max - 1)) + '\u2026';
  }

  // ---------------------------------------------------------------------------
  // 1. Markdown export
  // ---------------------------------------------------------------------------
  function serializeMarkdown(view, options) {
    options = options || {};
    view = view || {};
    var session = view.session || {};
    var items = resolveItems(view);
    var includeToolCalls = options.includeToolCalls !== false;
    var includeTimestamps = options.includeTimestamps !== false;
    var model = resolveModel(view, items);
    var lines = [];

    function blank() {
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
    }

    lines.push('# ' + resolveTitle(view, options));
    blank();

    var meta = [];
    if (session.cwd) meta.push('工作目录：`' + session.cwd + '`');
    meta.push('导出时间：' + formatDateTime(resolveMetaDate(view, options)));
    meta.push('消息数：' + items.length);
    if (model) meta.push('模型：' + model);
    lines.push('> ' + meta.join(' · '));
    blank();

    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      lines.push('### ' + roleLabel(item.kind));
      blank();
      if (includeTimestamps && item.time) {
        lines.push('*时间：' + formatDateTime(item.time) + '*');
        blank();
      }
      var text = typeof item.text === 'string' ? item.text : '';
      if (text.trim()) {
        lines.push(text.replace(/\s+$/, ''));
        blank();
      }
      // The Host payload reports an image count (a number); an array of image
      // references is also accepted so this engine stays usable on its own.
      var imageCount = Array.isArray(item.images) ? item.images.length
        : (typeof item.images === 'number' ? item.images : 0);
      if (imageCount > 0) {
        lines.push('*图片：' + imageCount + ' 张*');
        blank();
      }
      if (includeToolCalls && Array.isArray(item.toolCalls) && item.toolCalls.length) {
        for (var c = 0; c < item.toolCalls.length; c++) {
          var call = item.toolCalls[c] || {};
          var callLine = '- 工具调用：`' + String(call.name || 'tool') + '`';
          if (call.title) callLine += ' — ' + String(call.title);
          if (call.status) callLine += '（' + String(call.status) + '）';
          lines.push(callLine);
        }
        blank();
      }
    }

    lines.push('---');
    blank();
    lines.push('— 由 DSH 会话分享导出');
    return lines.join('\n') + '\n';
  }

  // ---------------------------------------------------------------------------
  // 2. Practical markdown subset parser (used by the canvas layout engine)
  // ---------------------------------------------------------------------------
  function parseMarkdown(text) {
    var blocks = [];
    var lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    var paragraph = [];
    var i = 0;

    function flushParagraph() {
      if (!paragraph.length) return;
      var joined = joinParagraph(paragraph);
      if (joined) blocks.push({ type: 'paragraph', text: joined });
      paragraph = [];
    }

    while (i < lines.length) {
      var line = lines[i];

      var fence = /^\s*(`{3,}|~{3,})\s*([\w+#.\-]*)\s*$/.exec(line);
      if (fence) {
        flushParagraph();
        var marker = fence[1].charAt(0);
        var minLength = fence[1].length;
        var codeLines = [];
        i++;
        while (i < lines.length) {
          var closing = new RegExp('^\\s*' + (marker === '`' ? '`' : '~') + '{' + minLength + ',}\\s*$');
          if (closing.test(lines[i])) { i++; break; }
          codeLines.push(lines[i]);
          i++;
        }
        blocks.push({ type: 'code', lines: codeLines, lang: fence[2] || '' });
        continue;
      }

      if (/^\s*$/.test(line)) { flushParagraph(); i++; continue; }

      var heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (heading) {
        flushParagraph();
        blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
        i++;
        continue;
      }

      if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
        flushParagraph();
        blocks.push({ type: 'hr' });
        i++;
        continue;
      }

      if (/^\s*>/.test(line)) {
        flushParagraph();
        var quoteLines = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        blocks.push({ type: 'quote', text: joinParagraph(quoteLines) });
        continue;
      }

      if (/^(\s*)([-*+]|\d+[.)])\s+/.test(line)) {
        flushParagraph();
        var items = [];
        while (i < lines.length) {
          var listItem = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
          if (listItem) {
            var ordered = /\d/.test(listItem[2].charAt(0));
            items.push({
              indent: Math.min(2, Math.floor(listItem[1].length / 2)),
              ordered: ordered,
              number: ordered ? parseInt(listItem[2], 10) : 0,
              text: listItem[3]
            });
            i++;
          } else if (items.length && /^\s+\S/.test(lines[i])) {
            items[items.length - 1].text += ' ' + lines[i].trim();
            i++;
          } else {
            break;
          }
        }
        blocks.push({ type: 'list', items: items });
        continue;
      }

      if (/^\s*\|/.test(line)) {
        flushParagraph();
        var rawTableLines = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) {
          rawTableLines.push(lines[i].trim());
          i++;
        }
        blocks.push(parseTable(rawTableLines));
        continue;
      }

      paragraph.push(line);
      i++;
    }

    flushParagraph();
    return blocks;
  }

  function joinParagraph(lines) {
    var out = '';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (!out) { out = line; continue; }
      var lastChar = out.charAt(out.length - 1);
      var firstChar = line.charAt(0);
      out += (CJK_RE.test(lastChar) || CJK_RE.test(firstChar)) ? line : ' ' + line;
    }
    return out;
  }

  /**
   * Split one markdown pipe table into header/data rows plus per-column
   * alignment. The `| --- | :---: |` separator row becomes alignment metadata;
   * a leading and trailing pipe are optional.
   */
  function parseTable(rawLines) {
    var rows = [];
    var aligns = [];
    for (var i = 0; i < rawLines.length; i++) {
      var cells = splitTableRow(rawLines[i]);
      if (!cells.length) continue;
      if (isTableSeparatorRow(cells)) {
        aligns = cells.map(tableAlignOf);
        continue;
      }
      rows.push(cells);
    }
    return { type: 'table', rows: rows, aligns: aligns };
  }

  /** Cells of one pipe-table line, trimmed; `\|` stays inside a cell. */
  function splitTableRow(line) {
    var text = String(line == null ? '' : line).trim();
    if (text.charAt(0) === '|') text = text.slice(1);
    if (text.charAt(text.length - 1) === '|') text = text.slice(0, -1);
    var cells = [];
    var buffer = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === '\\' && text.charAt(i + 1) === '|') {
        buffer += '|';
        i += 1;
      } else if (ch === '|') {
        cells.push(buffer.trim());
        buffer = '';
      } else {
        buffer += ch;
      }
    }
    cells.push(buffer.trim());
    return cells;
  }

  function isTableSeparatorRow(cells) {
    for (var i = 0; i < cells.length; i++) {
      if (!/^:?-{1,}:?$/.test(cells[i])) return false;
    }
    return true;
  }

  function tableAlignOf(cell) {
    var left = cell.charAt(0) === ':';
    var right = cell.charAt(cell.length - 1) === ':';
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  }

  function parseInline(text) {
    var spans = [];
    var source = String(text == null ? '' : text);
    var pattern = /(\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`|!\[[^\]]*\]\([^)]*\)|\[[^\]]*\]\([^)]*\)|\*[^*\s][^*]*\*)/g;
    var last = 0;
    var match;
    while ((match = pattern.exec(source))) {
      if (match.index > last) spans.push({ text: source.slice(last, match.index) });
      var token = match[0];
      if (token.slice(0, 2) === '**') {
        spans.push({ text: token.slice(2, -2), bold: true });
      } else if (token.slice(0, 2) === '~~') {
        spans.push({ text: token.slice(2, -2), strike: true });
      } else if (token.charAt(0) === '`') {
        spans.push({ text: token.slice(1, -1), code: true });
      } else if (token.slice(0, 2) === '![') {
        var alt = /^!\[([^\]]*)\]/.exec(token);
        spans.push({ text: '[图片' + (alt && alt[1] ? ': ' + alt[1] : '') + ']', italic: true, muted: true });
      } else if (token.charAt(0) === '[') {
        var label = /^\[([^\]]*)\]/.exec(token);
        spans.push({ text: label ? label[1] : token });
      } else {
        spans.push({ text: token.slice(1, -1), italic: true });
      }
      last = pattern.lastIndex;
    }
    if (last < source.length) spans.push({ text: source.slice(last) });
    return mergeSpans(spans);
  }

  function mergeSpans(spans) {
    var merged = [];
    for (var i = 0; i < spans.length; i++) {
      var span = spans[i];
      if (!span.text) continue;
      var previous = merged[merged.length - 1];
      if (previous && !!previous.bold === !!span.bold && !!previous.italic === !!span.italic &&
          !!previous.code === !!span.code && !!previous.strike === !!span.strike &&
          !!previous.muted === !!span.muted) {
        previous.text += span.text;
      } else {
        merged.push({
          text: span.text, bold: !!span.bold, italic: !!span.italic,
          code: !!span.code, strike: !!span.strike, muted: !!span.muted
        });
      }
    }
    return merged;
  }

  // ---------------------------------------------------------------------------
  // 3. Text styling and CJK-aware line wrapping
  // ---------------------------------------------------------------------------
  var measureCache = {};
  var measureCacheSize = 0;

  function fontString(size, style) {
    style = style || {};
    var prefix = '';
    if (style.italic) prefix += 'italic ';
    if (style.weight) prefix += style.weight + ' ';
    return prefix + size + 'px ' + (style.mono ? MONO : SANS);
  }

  function measureWidth(ctx, text, font) {
    var key = font + '\u0000' + text;
    var cached = measureCache[key];
    if (cached !== undefined) return cached;
    ctx.font = font;
    var metrics = ctx.measureText(text);
    var width = metrics && typeof metrics.width === 'number' ? metrics.width : text.length * 7;
    if (measureCacheSize > 5000) {
      measureCache = {};
      measureCacheSize = 0;
    }
    measureCache[key] = width;
    measureCacheSize++;
    return width;
  }

  function buildStyle(span, size, base) {
    base = base || {};
    var weight = base.weight || 0;
    if (span.bold && weight < 600) weight = 600;
    var italic = !!(span.italic || base.italic);
    var mono = !!(span.code || base.mono);
    var color = COLOR.text;
    if (span.muted) color = COLOR.muted;
    else if (span.code) color = COLOR.codeText;
    else if (base.color) color = base.color;
    return {
      font: fontString(size, { weight: weight, italic: italic, mono: mono }),
      color: color,
      code: !!span.code,
      strike: !!span.strike,
      size: size
    };
  }

  function toAtoms(spans, size, base) {
    var atoms = [];
    for (var i = 0; i < spans.length; i++) {
      var span = spans[i] || {};
      var style = buildStyle(span, size, base);
      var text = String(span.text == null ? '' : span.text);
      var buffer = '';
      for (var c = 0; c < text.length; c++) {
        var ch = text.charAt(c);
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\u00A0') {
          if (buffer) { atoms.push({ text: buffer, style: style }); buffer = ''; }
          atoms.push({ text: ' ', space: true, style: style });
        } else if (CJK_RE.test(ch)) {
          if (buffer) { atoms.push({ text: buffer, style: style }); buffer = ''; }
          atoms.push({ text: ch, style: style });
        } else {
          buffer += ch;
        }
      }
      if (buffer) atoms.push({ text: buffer, style: style });
    }
    return atoms;
  }

  function breakText(ctx, text, maxWidth, font) {
    var pieces = [];
    var buffer = '';
    var bufferWidth = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      var width = measureWidth(ctx, ch, font);
      if (buffer && bufferWidth + width > maxWidth) {
        pieces.push({ text: buffer, width: bufferWidth });
        buffer = '';
        bufferWidth = 0;
      }
      buffer += ch;
      bufferWidth += width;
    }
    if (buffer) pieces.push({ text: buffer, width: bufferWidth });
    if (!pieces.length) pieces.push({ text: text, width: 0 });
    return pieces;
  }

  function wrapSpans(ctx, spans, maxWidth, size, base) {
    var atoms = toAtoms(spans, size, base);
    var limit = Math.max(24, maxWidth);
    var lines = [];
    var current = { segments: [], width: 0 };
    var pendingSpace = null;

    function addSegment(text, style, x, width) {
      var segments = current.segments;
      var previous = segments[segments.length - 1];
      if (previous && previous.font === style.font && previous.color === style.color &&
          previous.code === style.code && previous.strike === style.strike) {
        previous.text += text;
        previous.width += width;
      } else {
        segments.push({
          text: text, x: x, width: width, font: style.font,
          color: style.color, code: style.code, strike: style.strike, size: style.size
        });
      }
    }

    function flushLine() {
      if (current.segments.length) lines.push(current);
      current = { segments: [], width: 0 };
      pendingSpace = null;
    }

    function placeOverflowAtom(atom) {
      var pieces = breakText(ctx, atom.text, limit, atom.style.font);
      for (var k = 0; k < pieces.length; k++) {
        addSegment(pieces[k].text, atom.style, current.width, pieces[k].width);
        current.width += pieces[k].width;
        if (k < pieces.length - 1) flushLine();
      }
    }

    for (var i = 0; i < atoms.length; i++) {
      var atom = atoms[i];
      if (atom.space) {
        if (current.width > 0) pendingSpace = atom;
        continue;
      }
      var width = measureWidth(ctx, atom.text, atom.style.font);
      var spaceWidth = pendingSpace && current.width > 0
        ? measureWidth(ctx, ' ', pendingSpace.style.font) : 0;
      if (current.segments.length && current.width + spaceWidth + width > limit) {
        flushLine();
        spaceWidth = 0;
      }
      if (pendingSpace && current.width > 0) {
        addSegment(' ', pendingSpace.style, current.width, spaceWidth);
        current.width += spaceWidth;
        pendingSpace = null;
      }
      if (!current.segments.length && width > limit) {
        placeOverflowAtom(atom);
      } else {
        addSegment(atom.text, atom.style, current.width, width);
        current.width += width;
      }
    }
    flushLine();
    if (!lines.length) lines.push({ segments: [], width: 0 });
    return lines;
  }

  function wrapCodeLine(ctx, text, maxWidth, font) {
    var pieces = [];
    var buffer = '';
    var bufferWidth = 0;
    var chars = String(text == null ? '' : text).replace(/\t/g, '  ');
    for (var i = 0; i < chars.length; i++) {
      var ch = chars.charAt(i);
      var width = measureWidth(ctx, ch, font);
      if (buffer && bufferWidth + width > maxWidth) {
        pieces.push({ text: buffer, width: bufferWidth });
        buffer = '';
        bufferWidth = 0;
      }
      buffer += ch;
      bufferWidth += width;
    }
    pieces.push({ text: buffer, width: bufferWidth });
    return pieces;
  }
// ---------------------------------------------------------------------------
  // 4. Layout engine (shared by PNG and PDF export)
  // ---------------------------------------------------------------------------
  function layoutDocument(ctx, view, options, contentWidth, mode) {
    options = options || {};
    mode = mode || {};
    view = view || {};
    var session = view.session || {};
    var items = resolveItems(view);
    var ops = [];
    var y = 0;
    var width = Math.max(120, contentWidth);

    function addRect(x, top, w, h, color, radius) {
      if (h <= 0 || w <= 0) return;
      ops.push({ type: 'rect', x: x, top: top, bottom: top + h, w: w, h: h, color: color, radius: radius || 0 });
    }

    function addRule(top) {
      addRect(0, top, width, 1, COLOR.separator, 0);
    }

    function addGap(amount) {
      if (amount > 0) y += amount;
    }

    function emitLines(lines, x, size, lineOptions) {
      lineOptions = lineOptions || {};
      var lineHeight = lineOptions.lineHeight || size * LINE_HEIGHT;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var top = y;
        y += lineHeight;
        var lineX = x;
        if (lineOptions.align === 'center') lineX = x + (width - line.width) / 2;
        else if (lineOptions.align === 'right') lineX = x + width - line.width;
        var segments = [];
        for (var s = 0; s < line.segments.length; s++) {
          var segment = line.segments[s];
          segments.push({
            text: segment.text, x: lineX + segment.x, width: segment.width,
            font: segment.font, color: segment.color,
            code: segment.code, strike: segment.strike, size: segment.size
          });
        }
        ops.push({
          type: 'text', top: top, bottom: top + lineHeight,
          baseline: top + lineHeight / 2 + size * 0.34, segments: segments
        });
      }
    }

    function drawTextLine(text, x, top, size, font, color, align) {
      var textWidth = measureWidth(ctx, text, font);
      var drawX = x;
      if (align === 'right') drawX = x - textWidth;
      else if (align === 'center') drawX = x - textWidth / 2;
      var lineHeight = size * LINE_HEIGHT;
      ops.push({
        type: 'text', top: top, bottom: top + lineHeight,
        baseline: top + lineHeight / 2 + size * 0.34,
        segments: [{ text: text, x: drawX, width: textWidth, font: font, color: color, code: false, strike: false, size: size }]
      });
    }

    function layoutNotice() {
      var text = '内容较长，图片已自动缩放（像素高度上限 ' + IMAGE_MAX_PIXEL_HEIGHT + ' 像素）';
      var padY = 8;
      var lines = wrapSpans(ctx, [{ text: text }], width - 24, SIZE.meta, { color: '#92400E' });
      var height = padY * 2 + lines.length * SIZE.meta * LINE_HEIGHT;
      addRect(0, y, width, height, '#FEF3C7', 8);
      y += padY;
      emitLines(lines, 12, SIZE.meta);
      y += padY;
      addGap(16);
    }

    function layoutHeader() {
      var title = resolveTitle(view, options);
      var titleLines = wrapSpans(ctx, [{ text: title }], width, SIZE.title, { weight: 700, color: COLOR.title });
      emitLines(titleLines, 0, SIZE.title, { lineHeight: SIZE.title * 1.3 });
      addGap(8);

      var metaParts = [];
      if (session.cwd) metaParts.push(String(session.cwd));
      metaParts.push(formatDateTime(resolveMetaDate(view, options)));
      metaParts.push('共 ' + items.length + ' 条消息');
      var model = resolveModel(view, items);
      if (model) metaParts.push(model);
      var metaLines = wrapSpans(ctx, [{ text: metaParts.join(' · ') }], width, SIZE.meta, { color: COLOR.meta });
      emitLines(metaLines, 0, SIZE.meta);
      addGap(16);
      addRule(y);
      y += 1;
      addGap(4);
    }

    function layoutRoleRow(item) {
      var role = ROLE[item.kind] || { label: roleLabel(item.kind), color: COLOR.muted, chipBg: COLOR.codeBg };
      var labelFont = fontString(12, { weight: 600 });
      var labelWidth = measureWidth(ctx, role.label, labelFont);
      var chipHeight = 22;
      var chipPadX = 10;
      var chipWidth = labelWidth + chipPadX * 2;
      var top = y;
      addRect(0, top, chipWidth, chipHeight, role.chipBg, 6);
      drawTextLine(role.label, chipPadX, top, 12, labelFont, role.color);
      var rightParts = [];
      if (options.includeTimestamps !== false && item.time) rightParts.push(formatDateTime(item.time));
      if (item.kind === 'assistant' && item.model) rightParts.push(String(item.model));
      if (rightParts.length) {
        var rightFont = fontString(12);
        var rightText = rightParts.join(' · ');
        var rightWidth = measureWidth(ctx, rightText, rightFont);
        if (rightWidth <= width - chipWidth - 24) {
          drawTextLine(rightText, width, top, 12, rightFont, COLOR.meta, 'right');
        }
      }
      y += chipHeight + 10;
    }

    function layoutToolCalls(calls) {
      if (!calls || !calls.length) return;
      for (var i = 0; i < calls.length; i++) {
        var call = calls[i] || {};
        var spans = [{ text: '\u25B8 ', muted: true }, { text: String(call.name || 'tool'), bold: true }];
        if (call.title) spans.push({ text: ' — ' + String(call.title), muted: true });
        if (call.status) spans.push({ text: '（' + String(call.status) + '）', muted: true });
        var lines = wrapSpans(ctx, spans, width - 16, SIZE.meta);
        emitLines(lines, 16, SIZE.meta);
        addGap(2);
      }
      addGap(4);
    }

    function layoutImages(item) {
      // The Host payload reports an image count (a number) and keeps the refs
      // that resolve to embedded bytes in `view.attachments`; an array of image
      // references is also accepted so this engine stays usable on its own.
      var count = Array.isArray(item && item.images) ? item.images.length
        : (typeof (item && item.images) === 'number' ? item.images : 0);
      if (count <= 0) return;
      var refs = item && Array.isArray(item.imageRefs) ? item.imageRefs : [];
      var imageMap = mode.images;
      var drawn = 0;

      if (imageMap && refs.length > 0) {
        for (var i = 0; i < refs.length; i++) {
          var ref = refs[i] || {};
          var entry = imageMap.get(String(ref.attachmentId || ''));
          if (!entry) continue;
          var naturalWidth = ref.width > 0 ? ref.width : (entry.width > 0 ? entry.width : 0);
          var naturalHeight = ref.height > 0 ? ref.height : (entry.height > 0 ? entry.height : 0);
          if (!(naturalWidth > 0) || !(naturalHeight > 0)) continue;
          var maxHeight = Math.min(mode.imageMaxHeight || 380, width * 1.4);
          var scale = Math.min(1, width / naturalWidth);
          var drawWidth = Math.round(naturalWidth * scale);
          var drawHeight = Math.round(naturalHeight * scale);
          if (drawHeight > maxHeight) {
            drawWidth = Math.round(naturalWidth * (maxHeight / naturalHeight));
            drawHeight = Math.round(maxHeight);
          }
          if (drawWidth < 8) continue;
          addGap(6);
          ops.push({ type: 'image', top: y, bottom: y + drawHeight, x: 0, w: drawWidth, h: drawHeight, img: entry.img });
          y += drawHeight;
          addGap(4);
          drawn += 1;
        }
      }

      if (drawn === 0) {
        var lines = wrapSpans(ctx, [{ text: '图片 ' + count + ' 张（导出未内嵌）', muted: true }], width, SIZE.meta);
        emitLines(lines, 0, SIZE.meta);
        addGap(4);
      }
    }

    function layoutList(block) {
      for (var i = 0; i < block.items.length; i++) {
        var item = block.items[i];
        var indent = item.indent * 18;
        var marker = item.ordered ? String(item.number || 1) + '.' : '•';
        var markerFont = fontString(SIZE.body, { weight: item.ordered ? 400 : 700 });
        var markerWidth = measureWidth(ctx, marker + ' ', markerFont);
        var available = Math.max(24, width - indent - markerWidth);
        var bodyLines = wrapSpans(ctx, parseInline(item.text), available, SIZE.body);
        var lineHeight = SIZE.body * LINE_HEIGHT;
        var top = y;
        drawTextLine(marker, indent, top, SIZE.body, markerFont, COLOR.muted);
        for (var l = 0; l < bodyLines.length; l++) {
          var line = bodyLines[l];
          var lineTop = top + l * lineHeight;
          var segments = [];
          for (var s = 0; s < line.segments.length; s++) {
            var segment = line.segments[s];
            segments.push({
              text: segment.text, x: indent + markerWidth + segment.x, width: segment.width,
              font: segment.font, color: segment.color,
              code: segment.code, strike: segment.strike, size: segment.size
            });
          }
          ops.push({
            type: 'text', top: lineTop, bottom: lineTop + lineHeight,
            baseline: lineTop + lineHeight / 2 + SIZE.body * 0.34, segments: segments
          });
        }
        y = top + Math.max(1, bodyLines.length) * lineHeight;
        addGap(3);
      }
      addGap(7);
    }

    /** Natural one-line width of one table cell, measured with its real font. */
    function tableNaturalWidth(cellText, header) {
      var lines = wrapSpans(ctx, parseInline(cellText), 1e6, SIZE.body, header ? { weight: 600 } : void 0);
      return lines.length > 0 ? lines[0].width : 0;
    }

    /**
     * Pipe-table rendering: proportional column widths fitted to the content
     * width, a shaded header row, wrapped cell text with inline markdown, and a
     * separator under every row. Tables are layout text, not images, so they
     * keep the same typography as the rest of the share card.
     */
    function layoutTable(block) {
      var rows = block.rows || [];
      if (!rows.length) return;
      var columnCount = 0;
      for (var r = 0; r < rows.length; r++) columnCount = Math.max(columnCount, rows[r].length);
      if (columnCount === 0) return;

      var padX = 8;
      var padY = 7;
      var lineHeight = SIZE.body * LINE_HEIGHT;
      var minColumn = 46;
      var natural = [];
      for (var c = 0; c < columnCount; c++) natural.push(minColumn);
      for (var r1 = 0; r1 < rows.length; r1++) {
        for (var c1 = 0; c1 < columnCount; c1++) {
          var cell = rows[r1][c1] == null ? '' : String(rows[r1][c1]);
          natural[c1] = Math.max(natural[c1], tableNaturalWidth(cell, r1 === 0) + padX * 2);
        }
      }

      var widths = natural.slice();
      var sum = 0;
      for (var w = 0; w < widths.length; w++) sum += widths[w];
      if (sum > width) {
        // Shrink the widest column a point at a time so every column keeps a
        // readable minimum while the table still fits the content width.
        var guard = 0;
        while (sum > width && guard < 20000) {
          var widest = 0;
          for (var k = 1; k < widths.length; k++) if (widths[k] > widths[widest]) widest = k;
          if (widths[widest] <= minColumn) break;
          widths[widest] -= 1;
          sum -= 1;
          guard += 1;
        }
      }
      var tableWidth = 0;
      for (var t = 0; t < widths.length; t++) tableWidth += widths[t];

      addGap(8);
      for (var row = 0; row < rows.length; row++) {
        var isHeader = row === 0;
        var cellLines = [];
        var rowHeight = padY * 2 + lineHeight;
        for (var col = 0; col < columnCount; col++) {
          var text = rows[row][col] == null ? '' : String(rows[row][col]);
          var innerWidth = Math.max(12, widths[col] - padX * 2);
          var lines = wrapSpans(ctx, parseInline(text), innerWidth, SIZE.body, isHeader ? { weight: 600 } : void 0);
          cellLines.push(lines);
          rowHeight = Math.max(rowHeight, padY * 2 + lines.length * lineHeight);
        }

        var top = y;
        if (isHeader) addRect(0, top, tableWidth, rowHeight, COLOR.codeBg, 0);
        var x = 0;
        for (var col2 = 0; col2 < columnCount; col2++) {
          var cellRows = cellLines[col2];
          var align = block.aligns && block.aligns[col2] ? block.aligns[col2] : 'left';
          for (var l = 0; l < cellRows.length; l++) {
            var line = cellRows[l];
            var offset = padX;
            if (align === 'center') offset = (widths[col2] - line.width) / 2;
            else if (align === 'right') offset = widths[col2] - padX - line.width;
            if (offset < padX) offset = padX;
            var segments = [];
            for (var s = 0; s < line.segments.length; s++) {
              var segment = line.segments[s];
              segments.push({
                text: segment.text, x: x + offset + segment.x, width: segment.width,
                font: segment.font, color: isHeader ? COLOR.title : segment.color,
                code: segment.code, strike: segment.strike, size: segment.size
              });
            }
            var lineTop = top + padY + l * lineHeight;
            ops.push({
              type: 'text', top: lineTop, bottom: lineTop + lineHeight,
              baseline: lineTop + lineHeight / 2 + SIZE.body * 0.34, segments: segments
            });
          }
          x += widths[col2];
        }
        y = top + rowHeight;
        addRect(0, y, tableWidth, 1, COLOR.separator, 0);
        y += 1;
      }
      addGap(12);
    }

    function layoutQuote(block) {
      var spans = parseInline(block.text);
      for (var i = 0; i < spans.length; i++) spans[i].muted = true;
      var lines = wrapSpans(ctx, spans, width - 16, SIZE.body);
      var lineHeight = SIZE.body * LINE_HEIGHT;
      var top = y;
      addRect(0, top, 3, Math.max(lineHeight, lines.length * lineHeight), COLOR.quoteBar, 1.5);
      emitLines(lines, 16, SIZE.body);
      addGap(10);
    }

    function layoutPre(rawLines) {
      var size = SIZE.code;
      var lineHeight = size * LINE_HEIGHT;
      var padY = 8;
      var padX = 12;
      var font = fontString(size, { mono: true });
      var innerWidth = width - padX * 2;
      var codeLines = [];
      for (var i = 0; i < rawLines.length; i++) {
        var pieces = wrapCodeLine(ctx, rawLines[i] == null ? '' : String(rawLines[i]), innerWidth, font);
        for (var p = 0; p < pieces.length; p++) codeLines.push(pieces[p]);
      }
      addGap(6);
      addRect(0, y, width, padY, COLOR.codeBg, 0);
      y += padY;
      for (var l = 0; l < codeLines.length; l++) {
        addRect(0, y, width, lineHeight, COLOR.codeBg, 0);
        var lineTop = y;
        ops.push({
          type: 'text', top: lineTop, bottom: lineTop + lineHeight,
          baseline: lineTop + lineHeight / 2 + size * 0.34,
          segments: [{ text: codeLines[l].text, x: padX, width: codeLines[l].width, font: font, color: COLOR.codeText, code: false, strike: false, size: size }]
        });
        y += lineHeight;
      }
      addRect(0, y, width, padY, COLOR.codeBg, 0);
      y += padY;
      addGap(12);
    }

    function layoutBlock(block, state) {
      if (block.type === 'heading') {
        var size = block.level === 1 ? SIZE.h1 : (block.level === 2 ? SIZE.h2 : SIZE.body);
        if (!state.first) addGap(10);
        var headingLines = wrapSpans(ctx, parseInline(block.text), width, size, { weight: 700, color: COLOR.title });
        emitLines(headingLines, 0, size, { lineHeight: size * 1.35 });
        addGap(6);
      } else if (block.type === 'paragraph') {
        var paragraphLines = wrapSpans(ctx, parseInline(block.text), width, SIZE.body);
        emitLines(paragraphLines, 0, SIZE.body);
        addGap(10);
      } else if (block.type === 'list') {
        layoutList(block);
      } else if (block.type === 'quote') {
        layoutQuote(block);
      } else if (block.type === 'code') {
        layoutPre(block.lines || []);
      } else if (block.type === 'table') {
        layoutTable(block);
      } else if (block.type === 'hr') {
        addGap(6);
        addRule(y);
        y += 1;
        addGap(12);
      }
      state.first = false;
    }

    function layoutMarkdown(text) {
      if (typeof text !== 'string' || !text.trim()) return;
      var blocks = parseMarkdown(text);
      var state = { first: true };
      for (var i = 0; i < blocks.length; i++) layoutBlock(blocks[i], state);
    }

    function layoutItem(item, index) {
      if (index > 0) {
        addGap(16);
        addRule(y);
        y += 1;
        addGap(16);
      } else {
        addGap(14);
      }
      layoutRoleRow(item);
      layoutMarkdown(typeof item.text === 'string' ? item.text : '');
      if (options.includeToolCalls !== false) layoutToolCalls(item.toolCalls);
      layoutImages(item);
    }

    function layoutEmptyState() {
      addGap(14);
      var lines = wrapSpans(ctx, [{ text: '（没有可分享的消息）', muted: true }], width, SIZE.body);
      emitLines(lines, 0, SIZE.body);
      addGap(14);
    }

    function layoutFooter() {
      addGap(22);
      addRule(y);
      y += 1;
      addGap(12);
      var text = '由 DSH 会话分享导出 · ' + formatDateTime(resolveMetaDate(view, options));
      var lines = wrapSpans(ctx, [{ text: text }], width, SIZE.meta, { color: COLOR.meta });
      emitLines(lines, 0, SIZE.meta, { align: 'center' });
      addGap(4);
    }

    if (mode.notice) layoutNotice();
    layoutHeader();
    if (!items.length) layoutEmptyState();
    for (var index = 0; index < items.length; index++) layoutItem(items[index] || {}, index);
    if (mode.footer) layoutFooter();

    return { ops: ops, height: y, width: width };
  }

  // ---------------------------------------------------------------------------
  // 5. Painting and pagination
  // ---------------------------------------------------------------------------
  function paginateOps(ops, pageHeight) {
    var pages = [];
    var index = 0;
    while (index < ops.length) {
      var startTop = ops[index].top;
      var limit = startTop + pageHeight + 0.001;
      var end = index;
      while (end < ops.length && ops[end].bottom <= limit) end++;
      if (end === index) end = index + 1;
      pages.push({ ops: ops.slice(index, end), startTop: startTop });
      index = end;
    }
    if (!pages.length) pages.push({ ops: [], startTop: 0 });
    return pages;
  }

  function paintOps(ctx, ops, offsetX, offsetY) {
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op.type === 'rect') {
        ctx.fillStyle = op.color;
        if (op.radius && typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(op.x + offsetX, op.top + offsetY, op.w, op.h, op.radius);
          ctx.fill();
        } else {
          ctx.fillRect(op.x + offsetX, op.top + offsetY, op.w, op.h);
        }
      } else if (op.type === 'text') {
        var baseline = op.baseline + offsetY;
        for (var s = 0; s < op.segments.length; s++) {
          var segment = op.segments[s];
          var x = segment.x + offsetX;
          if (segment.code) {
            ctx.fillStyle = COLOR.inlineCodeBg;
            ctx.fillRect(x - 2, baseline - segment.size * 0.95, segment.width + 4, segment.size * 1.3);
          }
          if (segment.strike) {
            ctx.fillStyle = segment.color;
            ctx.fillRect(x, baseline - segment.size * 0.3, segment.width, Math.max(1, segment.size * 0.07));
          }
          ctx.font = segment.font;
          ctx.fillStyle = segment.color;
          ctx.fillText(segment.text, x, baseline);
        }
      } else if (op.type === 'image') {
        try {
          ctx.drawImage(op.img, op.x + offsetX, op.top + offsetY, op.w, op.h);
        } catch (err) {
          /* one undrawable image never blanks the rest of the page */
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 5b. Embedded message images
  // ---------------------------------------------------------------------------
  /** Unique image refs referenced by the selected items, in render order. */
  function collectImageRefs(view) {
    var refs = [];
    var seen = {};
    var items = resolveItems(view);
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var itemRefs = Array.isArray(item.imageRefs) ? item.imageRefs : [];
      for (var r = 0; r < itemRefs.length; r++) {
        var ref = itemRefs[r] || {};
        var id = String(ref.attachmentId || '');
        if (id === '' || seen[id] === true) continue;
        seen[id] = true;
        refs.push({ id: id, ref: ref });
      }
    }
    return refs;
  }

  /**
   * Decode every attachment the selected items reference into an image map
   * (`attachmentId` -> `{ img, width, height }`). Attachments arrive from the
   * Host as `data:` URLs; a corrupt one is dropped, never fatal.
   */
  function loadAttachmentImages(view) {
    var refs = collectImageRefs(view);
    var attachments = view && view.attachments && typeof view.attachments === 'object' ? view.attachments : null;
    if (!refs.length || attachments === null) return Promise.resolve(new Map());
    var tasks = [];
    for (var i = 0; i < refs.length; i++) {
      var attachment = attachments[refs[i].id];
      if (attachment === null || attachment === void 0) continue;
      if (typeof attachment.dataUrl !== 'string' || attachment.dataUrl === '') continue;
      tasks.push(loadOneImage(refs[i].id, refs[i].ref, attachment));
    }
    return Promise.all(tasks).then(function (loaded) {
      var map = new Map();
      for (var k = 0; k < loaded.length; k++) {
        if (loaded[k] !== null) map.set(loaded[k].id, loaded[k]);
      }
      return map;
    });
  }

  /** Decode one data-URL attachment; resolves `null` when it cannot be drawn. */
  function loadOneImage(attachmentId, ref, attachment) {
    return new Promise(function (resolve) {
      var img;
      var settled = false;
      function settle(ok) {
        if (settled) return;
        settled = true;
        if (!ok || !img) {
          resolve(null);
          return;
        }
        var width = ref && ref.width > 0 ? ref.width
          : (attachment.width > 0 ? attachment.width : (img.naturalWidth || img.width || 0));
        var height = ref && ref.height > 0 ? ref.height
          : (attachment.height > 0 ? attachment.height : (img.naturalHeight || img.height || 0));
        resolve({ id: attachmentId, img: img, width: width, height: height });
      }
      try {
        img = document.createElement('img');
      } catch (err) {
        resolve(null);
        return;
      }
      if (!img || typeof img !== 'object') {
        resolve(null);
        return;
      }
      img.onload = function () { settle(true); };
      img.onerror = function () { settle(false); };
      try { img.decoding = 'async'; } catch (err) { /* older engines */ }
      // The source must be set before decode(): decode() called on an element
      // without a source rejects with InvalidStateError and the image would be
      // dropped even though it loads fine.
      try {
        img.src = attachment.dataUrl;
      } catch (err) {
        settle(false);
        return;
      }
      if (typeof img.decode === 'function') {
        try {
          img.decode().then(function () { settle(true); }, function () {
            /* onload/onerror above own the failure path */
          });
        } catch (err) {
          /* keep the onload/onerror path */
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Canvas / blob helpers
  // ---------------------------------------------------------------------------
  function cleanupCanvas(canvas) {
    try {
      canvas.width = 0;
      canvas.height = 0;
    } catch (err) { /* ignore */ }
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error('画布导出失败'));
        }, type, quality);
        return;
      }
      if (typeof canvas.convertToBlob === 'function') {
        canvas.convertToBlob({ type: type, quality: quality }).then(resolve, reject);
        return;
      }
      reject(new Error('当前浏览器不支持画布导出'));
    });
  }

  function blobToBytes(blob) {
    if (blob && typeof blob.arrayBuffer === 'function') {
      return blob.arrayBuffer().then(function (buffer) { return new Uint8Array(buffer); });
    }
    return new Promise(function (resolve, reject) {
      if (typeof FileReader === 'undefined') {
        reject(new Error('无法读取图片数据'));
        return;
      }
      var reader = new FileReader();
      reader.onload = function () { resolve(new Uint8Array(reader.result)); };
      reader.onerror = function () { reject(reader.error || new Error('无法读取图片数据')); };
      reader.readAsArrayBuffer(blob);
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Minimal hand-written PDF writer: one JPEG (DCTDecode) image per page.
  //    Every object offset is absolute, /Length is exact and the xref table is
  //    generated from the recorded offsets, so viewers accept the file.
  // ---------------------------------------------------------------------------
  function pdfDate(value) {
    var date = toDate(value) || new Date();
    return 'D:' + date.getUTCFullYear() + pad2(date.getUTCMonth() + 1) + pad2(date.getUTCDate()) +
      pad2(date.getUTCHours()) + pad2(date.getUTCMinutes()) + pad2(date.getUTCSeconds()) + 'Z';
  }

  function buildPdf(images, meta) {
    var encoder = new TextEncoder();
    var chunks = [];
    var total = 0;
    var offsets = [];
    var pageCount = images.length;
    var infoNumber = pageCount * 3 + 3;

    function push(data) {
      var bytes = typeof data === 'string' ? encoder.encode(data) : data;
      chunks.push(bytes);
      total += bytes.length;
    }

    function beginObject(number) {
      offsets[number] = total;
      push(number + ' 0 obj\n');
    }

    function padOffset(value) {
      var text = String(value);
      while (text.length < 10) text = '0' + text;
      return text;
    }

    push('%PDF-1.4\n');
    push('%DSH Session Share\n');

    beginObject(1);
    push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    beginObject(2);
    var kids = [];
    for (var i = 0; i < pageCount; i++) kids.push((3 + i * 3) + ' 0 R');
    push('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pageCount + ' >>\nendobj\n');

    for (var p = 0; p < pageCount; p++) {
      var image = images[p];
      var pageNumber = 3 + p * 3;
      var contentNumber = pageNumber + 1;
      var imageNumber = pageNumber + 2;

      beginObject(pageNumber);
      push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PDF_PAGE_WIDTH + ' ' + PDF_PAGE_HEIGHT + '] ' +
        '/Resources << /XObject << /Im0 ' + imageNumber + ' 0 R >> >> /Contents ' + contentNumber + ' 0 R >>\nendobj\n');

      var content = 'q\n' + PDF_PAGE_WIDTH + ' 0 0 ' + PDF_PAGE_HEIGHT + ' 0 0 cm\n/Im0 Do\nQ\n';
      var contentBytes = encoder.encode(content);
      beginObject(contentNumber);
      push('<< /Length ' + contentBytes.length + ' >>\nstream\n');
      push(contentBytes);
      push('\nendstream\nendobj\n');

      beginObject(imageNumber);
      push('<< /Type /XObject /Subtype /Image /Width ' + image.width + ' /Height ' + image.height +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + image.bytes.length +
        ' >>\nstream\n');
      push(image.bytes);
      push('\nendstream\nendobj\n');
    }

    beginObject(infoNumber);
    push('<< /Producer (DSH Session Share) /Creator (DSH Session Share) /CreationDate (' +
      pdfDate(meta && meta.generatedAt) + ') >>\nendobj\n');

    var xrefStart = total;
    var size = infoNumber + 1;
    push('xref\n0 ' + size + '\n');
    push('0000000000 65535 f \n');
    for (var n = 1; n < size; n++) {
      push(padOffset(offsets[n] || 0) + ' 00000 n \n');
    }
    push('trailer\n<< /Size ' + size + ' /Root 1 0 R /Info ' + infoNumber + ' 0 R >>\nstartxref\n' +
      xrefStart + '\n%%EOF\n');

    var output = new Uint8Array(total);
    var position = 0;
    for (var c = 0; c < chunks.length; c++) {
      output.set(chunks[c], position);
      position += chunks[c].length;
    }
    return output;
  }

  // ---------------------------------------------------------------------------
  // 8. PNG export: one tall image, optionally scaled down to stay under limits
  // ---------------------------------------------------------------------------
  function renderImage(view, options) {
    options = options || {};
    return loadAttachmentImages(view).then(function (embeddedImages) {
      return Promise.resolve().then(function () {
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('无法创建画布上下文');
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';

        var layout = layoutDocument(ctx, view, options, IMAGE_CONTENT_WIDTH, { footer: true, images: embeddedImages });
        var totalHeight = IMAGE_PAD_Y * 2 + layout.height;
        var scale = IMAGE_MAX_SCALE;
        var scaled = false;

        if (totalHeight > IMAGE_MAX_CSS_HEIGHT) {
          layout = layoutDocument(ctx, view, options, IMAGE_CONTENT_WIDTH, { footer: true, notice: true, images: embeddedImages });
          totalHeight = IMAGE_PAD_Y * 2 + layout.height;
          // The pixel-height cap is the hard limit (browsers refuse huge
          // canvases); the nominal floor only applies while the cap still holds.
          scale = Math.min(IMAGE_MAX_SCALE, IMAGE_MAX_PIXEL_HEIGHT / totalHeight);
          if (!(scale > 0.2)) scale = 0.2;
          scaled = scale < IMAGE_MAX_SCALE;
        }

        var pixelWidth = Math.max(1, Math.round(IMAGE_WIDTH * scale));
        var pixelHeight = Math.max(1, Math.round(totalHeight * scale));
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.fillStyle = COLOR.background;
        ctx.fillRect(0, 0, IMAGE_WIDTH, totalHeight);
        paintOps(ctx, layout.ops, IMAGE_PAD_X, IMAGE_PAD_Y);

        return canvasToBlob(canvas, 'image/png').then(function (blob) {
          cleanupCanvas(canvas);
          return { blob: blob, width: pixelWidth, height: pixelHeight, scaled: scaled };
        }, function (error) {
          cleanupCanvas(canvas);
          throw error;
        });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 9. PDF export: paginate the same layout into A4 JPEG pages
  // ---------------------------------------------------------------------------
  function renderPdfPage(page, pageIndex, pageCount, title) {
    var canvas = document.createElement('canvas');
    canvas.width = PDF_CANVAS_WIDTH;
    canvas.height = PDF_CANVAS_HEIGHT;
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建画布上下文');
    ctx.setTransform(PDF_CANVAS_SCALE, 0, 0, PDF_CANVAS_SCALE, 0, 0);
    ctx.fillStyle = COLOR.background;
    ctx.fillRect(0, 0, PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    ctx.save();
    ctx.beginPath();
    ctx.rect(PDF_MARGIN, PDF_MARGIN, PDF_CONTENT_WIDTH, PDF_CONTENT_HEIGHT);
    ctx.clip();
    paintOps(ctx, page.ops, PDF_MARGIN, PDF_MARGIN - page.startTop);
    ctx.restore();

    var footerFont = fontString(10);
    ctx.font = footerFont;
    ctx.fillStyle = COLOR.meta;
    var footerY = PDF_PAGE_HEIGHT - 30;
    ctx.fillText('DSH 会话分享 · ' + truncateText(title, 42), PDF_MARGIN, footerY);
    var rightText = '第 ' + (pageIndex + 1) + ' / ' + pageCount + ' 页';
    var rightWidth = measureWidth(ctx, rightText, footerFont);
    ctx.fillText(rightText, PDF_PAGE_WIDTH - PDF_MARGIN - rightWidth, footerY);

    return canvasToBlob(canvas, 'image/jpeg', PDF_JPEG_QUALITY).then(function (blob) {
      cleanupCanvas(canvas);
      return blobToBytes(blob);
    }, function (error) {
      cleanupCanvas(canvas);
      throw error;
    }).then(function (bytes) {
      return { bytes: bytes, width: PDF_CANVAS_WIDTH, height: PDF_CANVAS_HEIGHT };
    });
  }

  function renderPdf(view, options) {
    options = options || {};
    return loadAttachmentImages(view).then(function (embeddedImages) {
      return Promise.resolve().then(function () {
        var measureCanvas = document.createElement('canvas');
        var measureCtx = measureCanvas.getContext('2d');
        if (!measureCtx) throw new Error('无法创建画布上下文');
        measureCtx.textBaseline = 'alphabetic';
        measureCtx.textAlign = 'left';
        var layout = layoutDocument(measureCtx, view, options, PDF_CONTENT_WIDTH, {
          images: embeddedImages,
          imageMaxHeight: PDF_CONTENT_HEIGHT * 0.7,
        });
        cleanupCanvas(measureCanvas);

        var pages = paginateOps(layout.ops, PDF_CONTENT_HEIGHT);
        var title = resolveTitle(view, options);
        var images = [];
        var chain = Promise.resolve();
        pages.forEach(function (page, index) {
          chain = chain.then(function () {
            return renderPdfPage(page, index, pages.length, title).then(function (image) {
              images.push(image);
            });
          });
        });
        return chain.then(function () {
          var bytes = buildPdf(images, { title: title, generatedAt: resolveMetaDate(view, options) });
          return { blob: new Blob([bytes], { type: 'application/pdf' }), pages: pages.length };
        });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 10. Download helper
  // ---------------------------------------------------------------------------
  function sanitizeFilename(name) {
    var value = String(name == null ? '' : name)
      .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    value = value.replace(/^[.\s]+|[.\s]+$/g, '');
    if (!value) value = 'dsh-session-share';
    if (value.length > 120) value = value.slice(0, 120);
    return value;
  }

  function download(blob, filename) {
    var name = sanitizeFilename(filename);
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      throw new Error('当前环境不支持下载');
    }
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    var body = document.body || document.documentElement;
    body.appendChild(anchor);
    try {
      anchor.click();
    } finally {
      setTimeout(function () {
        try { if (anchor.parentNode) anchor.parentNode.removeChild(anchor); } catch (err) { /* ignore */ }
        try { URL.revokeObjectURL(url); } catch (err) { /* ignore */ }
      }, 4000);
    }
  }

  return {
    serializeMarkdown: serializeMarkdown,
    renderImage: renderImage,
    renderPdf: renderPdf,
    download: download
  };
}
