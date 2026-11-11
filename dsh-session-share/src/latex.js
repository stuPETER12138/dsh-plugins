/**
 * DSH session share - LaTeX math support for the export engine.
 *
 * This file is a plain chunk: it is inlined into the plugin client factory (see
 * tools/build-client.mjs), so it has no imports/exports and performs no DOM
 * access at evaluation time. The single entry point is createLatexEngine():
 *
 *   createLatexEngine() -> {
 *     toMathML(tex, displayMode) -> string | null     // pure TeX -> MathML text
 *     rasterize(formulas) -> Promise<Map>            // DOM/canvas, when called
 *     BASE_FONT, PAD                                  // raster geometry
 *   }
 *
 * The browser's own MathML engine lays the formula out inside an SVG
 * <foreignObject>; that SVG is decoded into an <img> and painted onto a canvas.
 * The canvas bitmap is then reused as an ordinary image box in the share-card
 * layout (PNG and PDF share the same layout engine).
 *
 * TeX coverage is deliberately a practical subset of KaTeX (what the DSH chat
 * itself renders): symbols, Greek, fractions, roots, scripts, accents,
 * \left...\right, matrices/cases/aligned environments and common text/styling
 * commands. Unknown commands degrade to visible text instead of failing.
 */
function createLatexEngine() {
  'use strict';

  // Canonical formula font size used for measuring and rasterising. Every
  // consumer scales the bitmap by targetSize / BASE_FONT, so the same entry can
  // be drawn at body, heading or display size.
  var BASE_FONT = 48;
  var PAD = 6;
  var MAX_FORMULAS = 200;
  var MAX_TEX_LENGTH = 6000;
  var MAX_DEPTH = 160;
  var RASTER_TIMEOUT = 8000;

  // -------------------------------------------------------------------------
  // Symbol tables
  // -------------------------------------------------------------------------
  var GREEK = {
    alpha: '\u03B1', beta: '\u03B2', gamma: '\u03B3', delta: '\u03B4',
    epsilon: '\u03F5', varepsilon: '\u03B5', zeta: '\u03B6', eta: '\u03B7',
    theta: '\u03B8', vartheta: '\u03D1', iota: '\u03B9', kappa: '\u03BA',
    lambda: '\u03BB', mu: '\u03BC', nu: '\u03BD', xi: '\u03BE',
    omicron: '\u03BF', pi: '\u03C0', varpi: '\u03D6', rho: '\u03C1',
    varrho: '\u03F1', sigma: '\u03C3', varsigma: '\u03C2', tau: '\u03C4',
    upsilon: '\u03C5', phi: '\u03D5', varphi: '\u03C6', chi: '\u03C7',
    psi: '\u03C8', omega: '\u03C9',
    Gamma: '\u0393', Delta: '\u0394', Theta: '\u0398', Lambda: '\u039B',
    Xi: '\u039E', Pi: '\u03A0', Sigma: '\u03A3', Upsilon: '\u03A5',
    Phi: '\u03A6', Psi: '\u03A8', Omega: '\u03A9'
  };

  var BIG_OPERATORS = {
    sum: '\u2211', prod: '\u220F', coprod: '\u2210', int: '\u222B',
    iint: '\u222C', iiint: '\u222D', oint: '\u222E', bigcup: '\u22C3',
    bigcap: '\u22C2', bigoplus: '\u2A01', bigotimes: '\u2A02',
    bigodot: '\u2A00', bigvee: '\u22C1', bigwedge: '\u22C0',
    bigsqcup: '\u2A06', smallint: '\u222B', intop: '\u222B'
  };

  var LIMIT_OPERATORS = {
    lim: 'lim', limsup: 'lim sup', liminf: 'lim inf', max: 'max',
    min: 'min', sup: 'sup', inf: 'inf', det: 'det', gcd: 'gcd',
    Pr: 'Pr', argmax: 'arg max', argmin: 'arg min', lg: 'lg'
  };

  var FUNCTIONS = {
    sin: 'sin', cos: 'cos', tan: 'tan', cot: 'cot', sec: 'sec',
    csc: 'csc', arcsin: 'arcsin', arccos: 'arccos', arctan: 'arctan',
    sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', coth: 'coth',
    log: 'log', ln: 'ln', exp: 'exp', dim: 'dim', ker: 'ker',
    hom: 'hom', deg: 'deg'
  };

  var SYMBOLS = {
    pm: '\u00B1', mp: '\u2213', times: '\u00D7', div: '\u00F7',
    cdot: '\u22C5', ast: '\u2217', star: '\u22C6', circ: '\u2218',
    bullet: '\u2022', oplus: '\u2295', ominus: '\u2296', otimes: '\u2297',
    oslash: '\u2298', odot: '\u2299', bigcirc: '\u25EF', dagger: '\u2020',
    ddagger: '\u2021', amalg: '\u2A3F',
    leq: '\u2264', le: '\u2264', geq: '\u2265', ge: '\u2265',
    neq: '\u2260', ne: '\u2260', equiv: '\u2261', approx: '\u2248',
    sim: '\u223C', simeq: '\u2243', cong: '\u2245', propto: '\u221D',
    ll: '\u226A', gg: '\u226B', prec: '\u227A', succ: '\u227B',
    preceq: '\u2AAF', succeq: '\u2AB0', subset: '\u2282',
    subseteq: '\u2286', supset: '\u2283', supseteq: '\u2287',
    in: '\u2208', notin: '\u2209', ni: '\u220B', mid: '\u2223',
    nmid: '\u2224', parallel: '\u2225', perp: '\u22A5', models: '\u22A8',
    vdash: '\u22A2', dashv: '\u22A3', bowtie: '\u22C8', smile: '\u2323',
    frown: '\u2322', asymp: '\u224D', doteq: '\u2250', triangle: '\u25B3',
    vartriangle: '\u25B3', square: '\u25A1', blacksquare: '\u25A0',
    to: '\u2192', rightarrow: '\u2192', leftarrow: '\u2190',
    gets: '\u2190', leftrightarrow: '\u2194', Leftarrow: '\u21D0',
    Rightarrow: '\u21D2', Leftrightarrow: '\u21D4', mapsto: '\u21A6',
    longrightarrow: '\u27F6', longleftarrow: '\u27F5',
    Longrightarrow: '\u27F9', Longleftarrow: '\u27F8',
    longleftrightarrow: '\u27F7', Longleftrightarrow: '\u27FA',
    uparrow: '\u2191', downarrow: '\u2193', updownarrow: '\u2195',
    Uparrow: '\u21D1', Downarrow: '\u21D3', Updownarrow: '\u21D5',
    nearrow: '\u2197', searrow: '\u2198', swarrow: '\u2199',
    nwarrow: '\u2196', rightrightarrows: '\u21C9',
    leftrightharpoons: '\u21CB', forall: '\u2200', exists: '\u2203',
    nexists: '\u2204', neg: '\u00AC', lnot: '\u00AC', land: '\u2227',
    wedge: '\u2227', lor: '\u2228', vee: '\u2228', implies: '\u27F9',
    iff: '\u27FA', infty: '\u221E', partial: '\u2202', nabla: '\u2207',
    emptyset: '\u2205', varnothing: '\u2205', angle: '\u2220',
    measuredangle: '\u2221', degree: '\u00B0', prime: '\u2032',
    backprime: '\u2033', dots: '\u2026', ldots: '\u2026', cdots: '\u22EF',
    vdots: '\u22EE', ddots: '\u22F1', dotsb: '\u2026', dotsm: '\u22EF',
    dotsc: '\u2026', ell: '\u2113', hbar: '\u210F', Re: '\u211C',
    Im: '\u2111', aleph: '\u2135', beth: '\u2136', gimel: '\u2137',
    wp: '\u2118', S: '\u00A7', P: '\u00B6', copyright: '\u00A9',
    textregistered: '\u00AE', langle: '\u27E8', rangle: '\u27E9',
    lfloor: '\u230A', rfloor: '\u230B', lceil: '\u2308',
    rceil: '\u2309', lbrace: '{', rbrace: '}', vert: '|', Vert: '\u2016',
    backslash: '\\', top: '\u22A4', bot: '\u22A5', therefore: '\u2234',
    because: '\u2235', triangleq: '\u225C', nless: '\u226E',
    ngtr: '\u226F', nleq: '\u2270', ngeq: '\u2271', nsubseteq: '\u2288',
    nsupseteq: '\u2289', notni: '\u220C', lhd: '\u22B2', rhd: '\u22B3',
    unrhd: '\u22B5', unlhd: '\u22B4', colon: ':'
  };

  // Symbols that MathML should treat as identifiers (italic) instead of
  // operators; everything else in SYMBOLS is emitted as <mo>.
  var SYMBOL_AS_IDENTIFIER = {
    ell: true, hbar: true, aleph: true, beth: true, gimel: true, wp: true,
    Re: true, Im: true
  };

  var NOT_MAP = {
    '=': '\u2260', '<': '\u226E', '>': '\u226F',
    in: '\u2209', ni: '\u220C', subset: '\u2284', supset: '\u2285',
    subseteq: '\u2288', supseteq: '\u2289', leq: '\u2270', geq: '\u2271',
    le: '\u2270', ge: '\u2271', equiv: '\u2262', sim: '\u2241',
    approx: '\u2249', cong: '\u2247', mid: '\u2224', parallel: '\u2226',
    exists: '\u2204', prec: '\u2280', succ: '\u2281', to: '\u219B',
    rightarrow: '\u219B', Rightarrow: '\u21CF'
  };

  var ACCENTS = {
    overline: { pos: 'over', char: '\u203E', stretchy: true },
    underline: { pos: 'under', char: '_', stretchy: true },
    bar: { pos: 'over', char: '\u00AF' },
    vec: { pos: 'over', char: '\u2192' },
    hat: { pos: 'over', char: '^' },
    widehat: { pos: 'over', char: '^', stretchy: true },
    tilde: { pos: 'over', char: '\u02DC' },
    widetilde: { pos: 'over', char: '\u02DC', stretchy: true },
    dot: { pos: 'over', char: '\u02D9' },
    ddot: { pos: 'over', char: '\u00A8' },
    dddot: { pos: 'over', char: '\u20DB' },
    check: { pos: 'over', char: '\u02C7' },
    breve: { pos: 'over', char: '\u02D8' },
    acute: { pos: 'over', char: '\u00B4' },
    grave: { pos: 'over', char: '`' },
    mathring: { pos: 'over', char: '\u02DA' },
    overbrace: { pos: 'over', char: '\u23DE', stretchy: true },
    underbrace: { pos: 'under', char: '\u23DF', stretchy: true }
  };

  var DELIMITER_COMMANDS = {
    '(': '(', ')': ')', '[': '[', ']': ']', '{': '{', '}': '}',
    '|': '|', '\\': '\u2016', '.': '.', '/': '/',
    langle: '\u27E8', rangle: '\u27E9', lfloor: '\u230A',
    rfloor: '\u230B', lceil: '\u2308', rceil: '\u2309',
    lbrace: '{', rbrace: '}', vert: '|', Vert: '\u2016',
    backslash: '\\', uparrow: '\u2191', downarrow: '\u2193',
    updownarrow: '\u2195', Uparrow: '\u21D1', Downarrow: '\u21D3',
    Updownarrow: '\u21D5'
  };

  var SPACING = {
    ',': '0.1667em', ':': '0.2222em', ';': '0.2778em',
    '!': '0em', ' ': '0.25em', quad: '1em', qquad: '2em',
    enspace: '0.5em', thinspace: '0.1667em', medspace: '0.2222em',
    thickspace: '0.2778em', negthinspace: '0em', negmedspace: '0em',
    negthickspace: '0em', nbsp: '0.25em'
  };

  // -------------------------------------------------------------------------
  // Unicode math-alphanumeric variants. Chromium ignores MathML
  // mathvariant="double-struck|script|..." (verified), so styling commands map
  // Latin/digit/Greek characters to the corresponding Unicode code points.
  // -------------------------------------------------------------------------
  function buildLetterMap(upper, lower) {
    var map = {};
    var i;
    for (i = 0; i < 26; i++) {
      map[String.fromCharCode(65 + i)] = String.fromCodePoint(upper + i);
      map[String.fromCharCode(97 + i)] = String.fromCodePoint(lower + i);
    }
    return map;
  }

  function buildDigitMap(start) {
    var map = {};
    for (var i = 0; i < 10; i++) map[String.fromCharCode(48 + i)] = String.fromCodePoint(start + i);
    return map;
  }

  function addOverrides(map, overrides) {
    for (var key in overrides) {
      if (Object.prototype.hasOwnProperty.call(overrides, key)) map[key] = overrides[key];
    }
    return map;
  }

  var VARIANT_MAPS = {
    bold: addOverrides(buildLetterMap(0x1D400, 0x1D41A), buildDigitMap(0x1D7CE)),
    italic: buildLetterMap(0x1D434, 0x1D44E),
    'bold-italic': buildLetterMap(0x1D468, 0x1D482),
    'sans': buildLetterMap(0x1D5A0, 0x1D5BA),
    mono: buildLetterMap(0x1D670, 0x1D68A),
    'double-struck': addOverrides(buildLetterMap(0x1D538, 0x1D552), {
      C: '\u2102', H: '\u210D', N: '\u2115', P: '\u2119', Q: '\u211A',
      R: '\u211D', Z: '\u2124'
    }),
    script: addOverrides(buildLetterMap(0x1D49C, 0x1D4B6), {
      B: '\u212C', E: '\u2130', F: '\u2131', H: '\u210B', I: '\u2110',
      L: '\u2112', M: '\u2133', R: '\u211B'
    }),
    fraktur: addOverrides(buildLetterMap(0x1D504, 0x1D51E), {
      C: '\u212D', H: '\u210C', I: '\u2111', R: '\u211C', Z: '\u2128'
    })
  };

  // Bold Greek (lowercase 0x1D6C2 onwards, capitals 0x1D6A8 onwards) with the
  // three letterlike exceptions the Unicode block has for capitals.
  var GREEK_ORDER = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta',
    'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron',
    'pi', 'rho', 'stigma', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi',
    'omega'];
  (function buildGreekVariants() {
    var boldLower = { theta: 0x1D6C9, phi: 0x1D6D7, pi: 0x1D6D1, rho: 0x1D6E0, sigma: 0x1D6E4, omega: 0x1D6EA, epsilon: 0x1D6C6, beta: 0x1D6C3, gamma: 0x1D6C4, delta: 0x1D6C5, zeta: 0x1D6C7, eta: 0x1D6C8, iota: 0x1D6CA, kappa: 0x1D6CB, lambda: 0x1D6CC, mu: 0x1D6CD, nu: 0x1D6CE, xi: 0x1D6CF, omicron: 0x1D6D0, tau: 0x1D6D5, upsilon: 0x1D6D6, chi: 0x1D6D8, psi: 0x1D6D9, varsigma: 0x1D6D3, varepsilon: 0x1D6C6, vartheta: 0x1D6C9, varphi: 0x1D6D7, varpi: 0x1D6D1, varrho: 0x1D6E0 };
    var boldUpper = { Gamma: 0x1D6A8, Delta: 0x1D6A9, Theta: 0x1D6AF, Lambda: 0x1D6B2, Xi: 0x1D6B5, Pi: 0x1D6B7, Sigma: 0x1D6BA, Upsilon: 0x1D6BD, Phi: 0x1D6BF, Psi: 0x1D6C1, Omega: 0x1D6C0 };
    var i;
    for (i = 0; i < GREEK_ORDER.length; i++) {
      var name = GREEK_ORDER[i];
      if (boldLower[name] !== undefined) {
        VARIANT_MAPS.bold[GREEK[name]] = String.fromCodePoint(boldLower[name]);
      }
    }
    for (var upper in boldUpper) {
      if (Object.prototype.hasOwnProperty.call(boldUpper, upper) && GREEK[upper]) {
        VARIANT_MAPS.bold[GREEK[upper]] = String.fromCodePoint(boldUpper[upper]);
      }
    }
  })();

  // -------------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------------
  function esc(text) {
    return String(text == null ? '' : text)
      // Keep valid surrogate pairs, replace lone halves so the SVG data URL can
      // always be URI-encoded.
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, function (match) {
        return match.length === 2 ? match : '\uFFFD';
      })
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function repeatChar(ch, count) {
    var out = '';
    for (var i = 0; i < count; i++) out += ch;
    return out;
  }

  function emptyRow() {
    return { t: 'row', items: [] };
  }

  function isCjkChar(ch) {
    return /[\u2E80-\u2FFF\u3000-\u303F\u3040-\u30FF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch);
  }

  function codePointOf(ch) {
    if (!ch) return 0;
    if (typeof ch.codePointAt === 'function') return ch.codePointAt(0);
    return ch.charCodeAt(0);
  }

  function classifyChar(ch) {
    var cp = codePointOf(ch);
    if (cp >= 48 && cp <= 57) return 'mn';
    if (isCjkChar(ch)) return 'mtext';
    if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)) return 'mi';
    if ((cp >= 0x0370 && cp <= 0x03FF) || (cp >= 0x2100 && cp <= 0x214F) ||
        (cp >= 0x1D400 && cp <= 0x1D7FF)) return 'mi';
    if (cp < 0x80) {
      var ascii = String.fromCharCode(cp);
      if ('+-=<>()[]{}|/\\.,;:!?\'"*'.indexOf(ascii) >= 0) return 'mo';
      return 'mi';
    }
    if ((cp >= 0x2190 && cp <= 0x21FF) || (cp >= 0x2200 && cp <= 0x22FF) ||
        (cp >= 0x27E8 && cp <= 0x27EF) || (cp >= 0x2A00 && cp <= 0x2AFF)) return 'mo';
    if (cp === 0x00B1 || cp === 0x00D7 || cp === 0x00F7 || cp === 0x221E ||
        cp === 0x2202 || cp === 0x2207 || cp === 0x00B0 || cp === 0x2032 ||
        cp === 0x2026) return 'mo';
    return 'mi';
  }

  function makesMo(ch) {
    return classifyChar(ch) === 'mo';
  }

  // -------------------------------------------------------------------------
  // Tokenizer: records character offsets so text-mode arguments can be sliced
  // verbatim from the source (whitespace is not significant in math mode).
  // -------------------------------------------------------------------------
  function tokenize(source) {
    var tokens = [];
    var i = 0;
    var n = source.length;
    while (i < n) {
      var ch = source.charAt(i);
      if (ch === '%') {
        while (i < n && source.charAt(i) !== '\n') i += 1;
        continue;
      }
      if (ch === '\\') {
        var next = source.charAt(i + 1);
        if (next === '') {
          tokens.push({ k: 'char', v: '\\', start: i, end: i + 1 });
          i += 1;
          continue;
        }
        if (/[a-zA-Z]/.test(next)) {
          var j = i + 1;
          while (j < n && /[a-zA-Z]/.test(source.charAt(j))) j += 1;
          tokens.push({ k: 'cmd', v: source.slice(i + 1, j), start: i, end: j });
          i = j;
          continue;
        }
        tokens.push({ k: 'cmd', v: next, start: i, end: i + 2 });
        i += 2;
        continue;
      }
      if (ch === '{') { tokens.push({ k: 'open', start: i, end: i + 1 }); i += 1; continue; }
      if (ch === '}') { tokens.push({ k: 'close', start: i, end: i + 1 }); i += 1; continue; }
      if (ch === '^') { tokens.push({ k: 'sup', start: i, end: i + 1 }); i += 1; continue; }
      if (ch === '_') { tokens.push({ k: 'sub', start: i, end: i + 1 }); i += 1; continue; }
      if (ch === '&') { tokens.push({ k: 'amp', start: i, end: i + 1 }); i += 1; continue; }
      if (ch === "'") { tokens.push({ k: 'prime', start: i, end: i + 1 }); i += 1; continue; }
      if (ch === '\n' || ch === '\r' || ch === ' ' || ch === '\t') { i += 1; continue; }
      if (/[0-9]/.test(ch)) {
        var d = i;
        while (d < n && /[0-9]/.test(source.charAt(d))) d += 1;
        if (source.charAt(d) === '.') {
          var after = d + 1;
          if (/[0-9]/.test(source.charAt(after))) {
            d = after;
            while (d < n && /[0-9]/.test(source.charAt(d))) d += 1;
          }
        }
        tokens.push({ k: 'number', v: source.slice(i, d), start: i, end: d });
        i = d;
        continue;
      }
      var code = ch.charCodeAt(0);
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < n) {
        var low = source.charCodeAt(i + 1);
        if (low >= 0xDC00 && low <= 0xDFFF) {
          tokens.push({ k: 'char', v: source.slice(i, i + 2), start: i, end: i + 2 });
          i += 2;
          continue;
        }
      }
      tokens.push({ k: 'char', v: ch, start: i, end: i + 1 });
      i += 1;
    }
    tokens.push({ k: 'eof', start: n, end: n });
    return tokens;
  }

  // -------------------------------------------------------------------------
  // Parser: TeX tokens -> a small AST (see emit* in the next section).
  // -------------------------------------------------------------------------
  function Parser(source, displayMode) {
    this.source = String(source == null ? '' : source);
    this.tokens = tokenize(this.source);
    this.pos = 0;
    this.display = !!displayMode;
    this.depth = 0;
    this.tag = '';
  }

  Parser.prototype.peek = function (offset) {
    var index = this.pos + (offset || 0);
    return this.tokens[index] || this.tokens[this.tokens.length - 1];
  };

  Parser.prototype.next = function () {
    var token = this.tokens[this.pos];
    if (token && token.k !== 'eof') this.pos += 1;
    return token;
  };

  Parser.prototype.skipSpace = function () {
    // Whitespace is dropped by the tokenizer, so nothing to do here; kept for
    // readability of the parser code.
  };

  Parser.prototype.parseAll = function () {
    var row = this.parseRow(this.stopAtEnd);
    return row;
  };

  Parser.prototype.stopAtEnd = function (token) {
    return token.k === 'eof';
  };

  Parser.prototype.parseRow = function (stop) {
    var items = [];
    var guard = 0;
    while (guard < 20000) {
      guard += 1;
      var token = this.peek();
      if (!token || token.k === 'eof') break;
      if (stop(this, token)) break;
      var before = this.pos;
      var node = this.parseAtomWithScripts();
      if (this.pos === before) break;
      if (node) items.push(node);
    }
    return { t: 'row', items: items };
  };

  Parser.prototype.parseAtomWithScripts = function () {
    var base;
    var token = this.peek();
    if (token.k === 'sup' || token.k === 'sub') {
      base = emptyRow();
    } else {
      base = this.parseAtom();
    }
    if (!base) return null;
    return this.parseScripts(base);
  };

  Parser.prototype.parseScripts = function (base) {
    var sub = null;
    var sup = null;
    var limits = null;
    var guard = 0;
    while (guard < 64) {
      guard += 1;
      var token = this.peek();
      if (token.k === 'cmd' && token.v === 'limits') { this.next(); limits = 'yes'; continue; }
      if (token.k === 'cmd' && token.v === 'nolimits') { this.next(); limits = 'no'; continue; }
      if (token.k === 'cmd' && (token.v === 'displaystyle' || token.v === 'textstyle')) { this.next(); continue; }
      if (token.k === 'prime') {
        this.next();
        var primes = this.parsePrimes();
        sup = sup ? mergeRows(sup, primes) : primes;
        continue;
      }
      if (token.k === 'sup') {
        this.next();
        sup = this.parseScriptArg();
        continue;
      }
      if (token.k === 'sub') {
        this.next();
        sub = this.parseScriptArg();
        continue;
      }
      break;
    }
    if (limits && base && base.t === 'op') base.limits = limits;
    if (!sub && !sup) return base;
    return { t: 'script', base: base, sub: sub, sup: sup };
  };

  Parser.prototype.parsePrimes = function () {
    var items = [];
    while (this.peek().k === 'prime') {
      this.next();
      items.push({ t: 'sym', kind: 'mo', text: '\u2032' });
    }
    return { t: 'row', items: items };
  };

  Parser.prototype.parseScriptArg = function () {
    var token = this.peek();
    if (token.k === 'open') {
      this.next();
      var row = this.parseRow(stopAtClose);
      if (this.peek().k === 'close') this.next();
      return row;
    }
    if (token.k === 'eof' || token.k === 'close') return emptyRow();
    this.next();
    var atom = this.atomFromToken(token);
    return atom || emptyRow();
  };

  function stopAtClose(parser, token) {
    return token.k === 'close';
  }

  function mergeRows(first, second) {
    if (!first) return second;
    if (!second) return first;
    var items = [];
    var i;
    for (i = 0; i < first.items.length; i++) items.push(first.items[i]);
    for (i = 0; i < second.items.length; i++) items.push(second.items[i]);
    return { t: 'row', items: items };
  }

  Parser.prototype.parseAtom = function () {
    if (this.depth > MAX_DEPTH) return { t: 'unknown', text: '' };
    var token = this.next();
    return this.atomFromToken(token);
  };

  Parser.prototype.atomFromToken = function (token) {
    if (!token) return null;
    if (token.k === 'open') {
      this.depth += 1;
      var row = this.parseRow(stopAtClose);
      this.depth -= 1;
      if (this.peek().k === 'close') this.next();
      return row;
    }
    if (token.k === 'close') return null;
    if (token.k === 'number') return { t: 'sym', kind: 'mn', text: token.v };
    if (token.k === 'char') return this.symbolForChar(token.v);
    if (token.k === 'prime') return { t: 'sym', kind: 'mo', text: '\u2032' };
    // A stray `&` outside an alignment environment is kept visible instead of
    // being dropped; inside matrix/cases rows it is consumed as a cell break.
    if (token.k === 'amp') return { t: 'sym', kind: 'mo', text: '&' };
    if (token.k === 'sup' || token.k === 'sub') return null;
    if (token.k === 'cmd') return this.parseCommand(token.v);
    return null;
  };

  Parser.prototype.symbolForChar = function (ch) {
    if (ch === '-') return { t: 'sym', kind: 'mo', text: '\u2212' };
    if (ch === '*') return { t: 'sym', kind: 'mo', text: '\u2217' };
    if (ch === '~') return { t: 'space', w: '0.25em' };
    return { t: 'sym', kind: classifyChar(ch), text: ch };
  };

  // Parse one required argument: a braced group or a single token (TeX
  // semantics: \frac12 means \frac{1}{2}).
  Parser.prototype.parseArg = function () {
    var token = this.peek();
    if (token.k === 'open') {
      this.next();
      this.depth += 1;
      var row = this.parseRow(stopAtClose);
      this.depth -= 1;
      if (this.peek().k === 'close') this.next();
      return row;
    }
    if (token.k === 'eof' || token.k === 'close') return emptyRow();
    this.next();
    if (token.k === 'number' && token.v.length > 1) {
      this.tokens.splice(this.pos, 0, {
        k: 'number', v: token.v.slice(1),
        start: token.start + 1, end: token.end
      });
      token = { k: 'number', v: token.v.charAt(0), start: token.start, end: token.start + 1 };
    }
    var atom = this.atomFromToken(token);
    return atom || emptyRow();
  };

  // Slice the raw source of a braced group (used for \text, \operatorname,
  // environment names and array column specs).
  Parser.prototype.parseRawGroup = function () {
    var open = this.peek();
    if (open.k !== 'open') return '';
    this.next();
    var depth = 1;
    var start = open.end;
    var guard = 0;
    while (this.pos < this.tokens.length && guard < 20000) {
      guard += 1;
      var token = this.tokens[this.pos];
      if (token.k === 'eof') break;
      if (token.k === 'open') depth += 1;
      else if (token.k === 'close') {
        depth -= 1;
        if (depth === 0) {
          this.next();
          return this.source.slice(start, token.start);
        }
      }
      this.next();
    }
    return this.source.slice(start);
  };

  // -------------------------------------------------------------------------
  // Command dispatch
  // -------------------------------------------------------------------------
  var ENVIRONMENTS = {
    matrix: { align: 'center' },
    smallmatrix: { align: 'center' },
    pmatrix: { align: 'center', left: '(', right: ')' },
    bmatrix: { align: 'center', left: '[', right: ']' },
    Bmatrix: { align: 'center', left: '{', right: '}' },
    vmatrix: { align: 'center', left: '|', right: '|' },
    Vmatrix: { align: 'center', left: '\u2016', right: '\u2016' },
    cases: { alignPattern: ['left', 'left'], left: '{' },
    dcases: { alignPattern: ['left', 'left'], left: '{' },
    rcases: { alignPattern: ['left', 'left'], right: '}' },
    aligned: { alignPattern: ['right', 'left'] },
    'aligned*': { alignPattern: ['right', 'left'] },
    align: { alignPattern: ['right', 'left'] },
    'align*': { alignPattern: ['right', 'left'] },
    split: { alignPattern: ['right', 'left'] },
    gather: { align: 'center' },
    'gather*': { align: 'center' },
    multline: { align: 'center' },
    'multline*': { align: 'center' },
    array: { align: 'center', arraySpec: true },
    'array*': { align: 'center', arraySpec: true },
    equation: { transparent: true },
    'equation*': { transparent: true },
    displaymath: { transparent: true },
    math: { transparent: true }
  };

  Parser.prototype.parseCommand = function (name) {
    var token;
    var first;
    var second;
    switch (name) {
      case 'frac':
      case 'dfrac':
      case 'tfrac':
      case 'cfrac':
        return { t: 'frac', num: this.parseArg(), den: this.parseArg() };

      case 'binom':
      case 'dbinom':
      case 'tbinom': {
        var binom = { t: 'frac', num: this.parseArg(), den: this.parseArg(), bar: false };
        return { t: 'fence', left: '(', right: ')', body: { t: 'row', items: [binom] } };
      }

      case 'sqrt': {
        var index = null;
        token = this.peek();
        if (token.k === 'char' && token.v === '[') {
          this.next();
          this.depth += 1;
          index = this.parseRow(function (parser, current) {
            return current.k === 'char' && current.v === ']';
          });
          this.depth -= 1;
          if (this.peek().k === 'char' && this.peek().v === ']') this.next();
        }
        return { t: 'sqrt', index: index, body: this.parseArg() };
      }

      case 'left':
        return this.parseFence();

      case 'right':
      case 'middle': {
        var delim = this.readDelimiter();
        return delim === null ? null : { t: 'sym', kind: 'mo', text: delim };
      }

      case 'begin':
        return this.parseEnvironment();

      case 'end':
        this.parseRawGroup();
        return emptyRow();

      case 'text':
      case 'textrm':
      case 'mbox':
      case 'hbox':
      case 'textnormal':
        return { t: 'text', text: cleanText(this.parseRawGroup()) };

      case 'textbf':
        return { t: 'text', text: cleanText(this.parseRawGroup()), bold: true };
      case 'textit':
        return { t: 'text', text: cleanText(this.parseRawGroup()), italic: true };
      case 'textsf':
        return { t: 'text', text: cleanText(this.parseRawGroup()), sans: true };
      case 'texttt':
        return { t: 'text', text: cleanText(this.parseRawGroup()), mono: true };

      case 'operatorname':
      case 'operatorname*':
        return { t: 'func', text: cleanText(this.parseRawGroup()).replace(/\u00A0/g, ' ') };

      case 'mathrm':
        return applyVariant(this.parseArg(), 'normal');
      case 'mathbf':
        return applyVariant(this.parseArg(), 'bold');
      case 'mathit':
        return applyVariant(this.parseArg(), 'italic');
      case 'mathnormal':
        return applyVariant(this.parseArg(), 'normal');
      case 'mathbb':
        return applyVariant(this.parseArg(), 'double-struck');
      case 'mathcal':
        return applyVariant(this.parseArg(), 'script');
      case 'mathfrak':
        return applyVariant(this.parseArg(), 'fraktur');
      case 'mathsf':
        return applyVariant(this.parseArg(), 'sans');
      case 'mathtt':
        return applyVariant(this.parseArg(), 'mono');
      case 'boldsymbol':
      case 'bm':
        return applyVariant(this.parseArg(), 'bold-italic');

      case 'overline':
      case 'underline':
      case 'bar':
      case 'vec':
      case 'hat':
      case 'widehat':
      case 'tilde':
      case 'widetilde':
      case 'dot':
      case 'ddot':
      case 'dddot':
      case 'check':
      case 'breve':
      case 'acute':
      case 'grave':
      case 'mathring':
      case 'overbrace':
      case 'underbrace': {
        var accent = ACCENTS[name];
        return {
          t: 'accent', pos: accent.pos, char: accent.char,
          stretchy: !!accent.stretchy, body: this.parseArg()
        };
      }

      case 'overset':
      case 'stackrel':
        first = this.parseArg();
        second = this.parseArg();
        return { t: 'limits', base: second, over: first };

      case 'underset':
        first = this.parseArg();
        second = this.parseArg();
        return { t: 'limits', base: second, under: first };

      case 'not':
        return this.parseNot();

      case 'hspace':
      case 'hspace*':
      case 'vspace':
      case 'vspace*':
      case 'rule':
      case 'label':
      case 'unskip':
        this.parseRawGroup();
        return emptyRow();

      case 'phantom':
      case 'hphantom':
      case 'vphantom':
        this.parseArg();
        return emptyRow();

      case 'tag':
        this.tag = cleanText(this.parseRawGroup());
        return emptyRow();

      case 'color':
      case 'pagecolor':
        this.parseRawGroup();
        return emptyRow();

      case 'textcolor':
        this.parseRawGroup();
        return this.parseArg();

      case 'pmod':
        first = this.parseArg();
        return {
          t: 'row',
          items: [
            { t: 'space', w: '0.25em' },
            { t: 'sym', kind: 'mo', text: '(' },
            { t: 'text', text: 'mod' },
            { t: 'space', w: '0.25em' },
            first,
            { t: 'sym', kind: 'mo', text: ')' }
          ]
        };

      case 'bmod':
      case 'mod':
        return {
          t: 'row',
          items: [
            { t: 'space', w: '0.25em' },
            { t: 'text', text: 'mod' },
            { t: 'space', w: '0.25em' }
          ]
        };

      case 'pod':
        first = this.parseArg();
        return {
          t: 'row',
          items: [
            { t: 'sym', kind: 'mo', text: '(' },
            first,
            { t: 'sym', kind: 'mo', text: ')' }
          ]
        };

      case 'limits':
      case 'nolimits':
      case 'displaystyle':
      case 'textstyle':
      case 'scriptstyle':
      case 'scriptscriptstyle':
      case 'mathstrut':
        return emptyRow();

      case 'big':
      case 'Big':
      case 'bigg':
      case 'Bigg':
      case 'bigl':
      case 'bigr':
      case 'Bigl':
      case 'Bigr':
      case 'biggl':
      case 'biggr':
      case 'Biggl':
      case 'Biggr':
      case 'bigm':
      case 'Bigm': {
        var bigDelim = this.readDelimiter();
        return bigDelim === null ? null : { t: 'sym', kind: 'mo', text: bigDelim };
      }

      case 'colon':
        return { t: 'sym', kind: 'mo', text: ':' };

      case '\\':
        return { t: 'space', w: '0em' };

      case '{':
      case '}':
      case '|':
      case '/':
        return { t: 'sym', kind: 'mo', text: DELIMITER_COMMANDS[name] };

      case '%':
      case '$':
      case '#':
      case '&':
      case '_':
        return { t: 'sym', kind: 'mo', text: name };

      case 'quad':
      case 'qquad':
      case 'enspace':
      case 'thinspace':
      case 'medspace':
      case 'thickspace':
      case 'negthinspace':
      case 'negmedspace':
      case 'negthickspace':
      case 'nbsp':
        return { t: 'space', w: SPACING[name] };
    }

    if (GREEK[name] !== undefined) {
      return { t: 'sym', kind: 'mi', text: GREEK[name] };
    }
    if (BIG_OPERATORS[name] !== undefined) {
      return {
        t: 'op', big: true, char: BIG_OPERATORS[name],
        text: BIG_OPERATORS[name], limits: 'display'
      };
    }
    if (LIMIT_OPERATORS[name] !== undefined) {
      return { t: 'op', big: false, text: LIMIT_OPERATORS[name], limits: 'always' };
    }
    if (FUNCTIONS[name] !== undefined) {
      return { t: 'func', text: FUNCTIONS[name] };
    }
    if (SYMBOLS[name] !== undefined) {
      return {
        t: 'sym',
        kind: SYMBOL_AS_IDENTIFIER[name] ? 'mi' : 'mo',
        text: SYMBOLS[name]
      };
    }
    if (SPACING[name] !== undefined) {
      return { t: 'space', w: SPACING[name] };
    }
    return { t: 'unknown', text: '\\' + name };
  };

  Parser.prototype.parseNot = function () {
    var token = this.peek();
    if (token.k === 'char' && NOT_MAP[token.v] !== undefined) {
      this.next();
      return { t: 'sym', kind: 'mo', text: NOT_MAP[token.v] };
    }
    if (token.k === 'cmd' && NOT_MAP[token.v] !== undefined) {
      this.next();
      return { t: 'sym', kind: 'mo', text: NOT_MAP[token.v] };
    }
    if (token.k === 'cmd') {
      // For symbols without a precomposed negation, let the symbol show and
      // drop the slash rather than emitting a stray mark.
      return { t: 'sym', kind: 'mo', text: '\u00AC' };
    }
    return { t: 'sym', kind: 'mo', text: '\u00AC' };
  };

  Parser.prototype.readDelimiter = function () {
    var token = this.peek();
    if (!token) return null;
    if (token.k === 'char') {
      this.next();
      return token.v === '.' ? null : token.v;
    }
    if (token.k === 'cmd') {
      this.next();
      if (token.v === '.') return null;
      if (DELIMITER_COMMANDS[token.v] !== undefined) return DELIMITER_COMMANDS[token.v];
      if (SYMBOLS[token.v] !== undefined) return SYMBOLS[token.v];
      if (GREEK[token.v] !== undefined) return GREEK[token.v];
      return null;
    }
    return null;
  };

  Parser.prototype.parseFence = function () {
    var left = this.readDelimiter();
    var items = [];
    var guard = 0;
    while (guard < 20000) {
      guard += 1;
      var token = this.peek();
      if (!token || token.k === 'eof') break;
      if (token.k === 'cmd' && token.v === 'right') break;
      if (token.k === 'cmd' && token.v === 'middle') {
        this.next();
        var middle = this.readDelimiter();
        if (middle !== null) items.push({ t: 'sym', kind: 'mo', text: middle });
        continue;
      }
      var before = this.pos;
      this.depth += 1;
      var node = this.parseAtomWithScripts();
      this.depth -= 1;
      if (this.pos === before) break;
      if (node) items.push(node);
    }
    var right = null;
    if (this.peek().k === 'cmd' && this.peek().v === 'right') {
      this.next();
      right = this.readDelimiter();
    }
    return { t: 'fence', left: left, right: right, body: { t: 'row', items: items } };
  };

  Parser.prototype.skipOptionalRowSize = function () {
    var token = this.peek();
    if (token.k !== 'char' || token.v !== '[') return;
    this.next();
    var guard = 0;
    while (guard < 100) {
      guard += 1;
      var current = this.peek();
      if (!current || current.k === 'eof') return;
      this.next();
      if (current.k === 'char' && current.v === ']') return;
    }
  };

  Parser.prototype.parseEnvironment = function () {
    var name = this.parseRawGroup().replace(/\s+/g, '');
    var spec = ENVIRONMENTS[name];
    if (!spec && name.indexOf('align') === 0) spec = ENVIRONMENTS.aligned;
    if (!spec) spec = { align: 'center' };

    if (spec.transparent) {
      var body = this.parseRow(function (parser, token) {
        return token.k === 'cmd' && token.v === 'end';
      });
      if (this.peek().k === 'cmd' && this.peek().v === 'end') {
        this.next();
        this.parseRawGroup();
      }
      return body;
    }

    var aligns = spec.alignPattern ? spec.alignPattern.slice() : null;
    if (spec.arraySpec) {
      var columnSpec = this.parseRawGroup();
      aligns = [];
      for (var c = 0; c < columnSpec.length; c += 1) {
        var letter = columnSpec.charAt(c);
        if (letter === 'l') aligns.push('left');
        else if (letter === 'r') aligns.push('right');
        else if (letter === 'c') aligns.push('center');
      }
      if (!aligns.length) aligns = null;
    }

    var rows = [];
    var row = [];
    var guard = 0;
    while (guard < 20000) {
      guard += 1;
      var cell = this.parseRow(function (parser, token) {
        if (token.k === 'amp') return true;
        return token.k === 'cmd' && (token.v === '\\' || token.v === 'end');
      });
      row.push(cell);
      var current = this.peek();
      if (current.k === 'amp') {
        this.next();
        continue;
      }
      if (current.k === 'cmd' && current.v === '\\') {
        this.next();
        rows.push(row);
        row = [];
        this.skipOptionalRowSize();
        continue;
      }
      if (current.k === 'cmd' && current.v === 'end') {
        this.next();
        this.parseRawGroup();
        rows.push(row);
        break;
      }
      rows.push(row);
      break;
    }
    return {
      t: 'table', rows: rows, aligns: aligns,
      left: spec.left || null, right: spec.right || null,
      align: spec.align || null
    };
  };

  // -------------------------------------------------------------------------
  // Text mode (\text{...}, \operatorname{...}) and styling commands
  // -------------------------------------------------------------------------
  function cleanText(raw) {
    var text = String(raw == null ? '' : raw);
    var out = '';
    var i = 0;
    var n = text.length;
    while (i < n) {
      var ch = text.charAt(i);
      if (ch === '\\') {
        var next = text.charAt(i + 1);
        if (next === '') { out += '\\'; break; }
        if (/[a-zA-Z]/.test(next)) {
          var j = i + 1;
          while (j < n && /[a-zA-Z]/.test(text.charAt(j))) j += 1;
          var word = text.slice(i + 1, j);
          if (GREEK[word] !== undefined) out += GREEK[word];
          else if (SYMBOLS[word] !== undefined) out += SYMBOLS[word];
          else if (SPACING[word] !== undefined) out += '\u00A0';
          else out += '\\' + word;
          i = j;
          continue;
        }
        if ('{}%$&#_ '.indexOf(next) >= 0) {
          out += next === ' ' ? '\u00A0' : next;
          i += 2;
          continue;
        }
        out += next;
        i += 2;
        continue;
      }
      if (ch === '~') { out += '\u00A0'; i += 1; continue; }
      if (ch === '{' || ch === '}') { i += 1; continue; }
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
        out += '\u00A0';
        i += 1;
        continue;
      }
      out += ch;
      i += 1;
    }
    return out.replace(/\u00A0+/g, '\u00A0').replace(/^\u00A0+|\u00A0+$/g, '');
  }

  function applyVariant(node, variant) {
    if (!node) return node;
    if (variant === 'normal') {
      return mapVariantNode(node, VARIANT_NORMAL);
    }
    var map = VARIANT_MAPS[variant];
    if (!map) return node;
    return mapVariantNode(node, map);
  }

  // `normal` variant: single-letter identifiers become upright text; digits and
  // operators are already upright.
  var VARIANT_NORMAL = { __normal: true };

  function mapVariantNode(node, map) {
    if (!node) return node;
    var i;
    switch (node.t) {
      case 'row':
        for (i = 0; i < node.items.length; i += 1) node.items[i] = mapVariantNode(node.items[i], map);
        return node;
      case 'sym':
        if (node.kind === 'mi' || node.kind === 'mn' || node.kind === 'mtext') {
          if (map.__normal) {
            if (node.kind === 'mi') node.kind = 'mtext';
            return node;
          }
          var out = '';
          for (i = 0; i < node.text.length; i += 1) {
            var ch = node.text.charAt(i);
            out += map[ch] !== undefined ? map[ch] : ch;
          }
          node.text = out;
        }
        return node;
      case 'frac':
        node.num = mapVariantNode(node.num, map);
        node.den = mapVariantNode(node.den, map);
        return node;
      case 'sqrt':
        if (node.index) node.index = mapVariantNode(node.index, map);
        node.body = mapVariantNode(node.body, map);
        return node;
      case 'script':
        node.base = mapVariantNode(node.base, map);
        if (node.sub) node.sub = mapVariantNode(node.sub, map);
        if (node.sup) node.sup = mapVariantNode(node.sup, map);
        return node;
      case 'accent':
        node.body = mapVariantNode(node.body, map);
        return node;
      case 'limits':
        node.base = mapVariantNode(node.base, map);
        if (node.over) node.over = mapVariantNode(node.over, map);
        if (node.under) node.under = mapVariantNode(node.under, map);
        return node;
      case 'fence':
        node.body = mapVariantNode(node.body, map);
        return node;
      case 'table':
        for (i = 0; i < node.rows.length; i += 1) {
          for (var c = 0; c < node.rows[i].length; c += 1) {
            node.rows[i][c] = mapVariantNode(node.rows[i][c], map);
          }
        }
        return node;
      case 'text':
        if (map === VARIANT_MAPS.bold) node.bold = true;
        else if (map === VARIANT_MAPS.italic || map === VARIANT_MAPS['bold-italic']) node.italic = true;
        return node;
      default:
        return node;
    }
  }

  // -------------------------------------------------------------------------
  // MathML serializer
  // -------------------------------------------------------------------------
  var activeDisplay = false;

  function emit(node) {
    if (!node) return '';
    switch (node.t) {
      case 'row': {
        var out = '';
        for (var i = 0; i < node.items.length; i += 1) out += emit(node.items[i]);
        return '<mrow>' + out + '</mrow>';
      }
      case 'sym':
        return '<' + node.kind + '>' + esc(node.text) + '</' + node.kind + '>';
      case 'text':
        return emitText(node);
      case 'func':
        return '<mtext>' + esc(node.text) + '</mtext><mspace width="0.1667em"/>';
      case 'op':
        return emitOp(node);
      case 'frac':
        return '<mfrac' + (node.bar === false ? ' linethickness="0"' : '') + '>' +
          emit(node.num) + emit(node.den) + '</mfrac>';
      case 'sqrt':
        return node.index
          ? '<mroot>' + emit(node.body) + emit(node.index) + '</mroot>'
          : '<msqrt>' + emit(node.body) + '</msqrt>';
      case 'script':
        return emitScript(node);
      case 'accent':
        return emitAccent(node);
      case 'limits':
        return emitLimits(node);
      case 'fence':
        return emitFence(node);
      case 'table':
        return emitTable(node);
      case 'space': {
        var width = node.w || '0em';
        if (width.charAt(0) === '-') width = '0em';
        return '<mspace width="' + width + '"/>';
      }
      case 'unknown':
        return '<mtext>' + esc(node.text) + '</mtext>';
      default:
        return '';
    }
  }

  function emitText(node) {
    var style = '';
    if (node.bold) style += 'font-weight:700;';
    if (node.italic) style += 'font-style:italic;';
    if (node.sans) style += 'font-family:sans-serif;';
    if (node.mono) style += 'font-family:monospace;';
    return '<mtext' + (style ? ' style="' + style + '"' : '') + '>' +
      esc(node.text) + '</mtext>';
  }

  function emitOp(node) {
    if (node.big) {
      return '<mo largeop="true">' + esc(node.text) + '</mo>';
    }
    return '<mtext>' + esc(node.text) + '</mtext>';
  }

  function shouldUseLimits(node) {
    if (!node || node.t !== 'op') return false;
    if (node.limits === 'always') return true;
    return node.limits !== 'no' && !!node.big && activeDisplay;
  }

  function emitScript(node) {
    var base = node.base || emptyRow();
    if (base.t === 'op' && shouldUseLimits(base)) {
      var tag = node.sub && node.sup ? 'munderover' : (node.sub ? 'munder' : 'mover');
      var html = '<' + tag + '>' + emitOp(base);
      if (node.sub) html += emit(node.sub);
      if (node.sup) html += emit(node.sup);
      return html + '</' + tag + '>';
    }
    if (node.sub && node.sup) {
      return '<msubsup>' + emit(base) + emit(node.sub) + emit(node.sup) + '</msubsup>';
    }
    if (node.sup) return '<msup>' + emit(base) + emit(node.sup) + '</msup>';
    return '<msub>' + emit(base) + emit(node.sub) + '</msub>';
  }

  function emitAccent(node) {
    var tag = node.pos === 'under' ? 'munder' : 'mover';
    var attribute = node.pos === 'under' ? 'accentunder="true"' : 'accent="true"';
    return '<' + tag + ' ' + attribute + '>' + emit(node.body) +
      '<mo' + (node.stretchy ? ' stretchy="true"' : '') + '>' + esc(node.char) +
      '</mo></' + tag + '>';
  }

  function emitLimits(node) {
    if (node.over && node.under) {
      return '<munderover accent="false" accentunder="false">' + emit(node.base) +
        emit(node.under) + emit(node.over) + '</munderover>';
    }
    if (node.over) {
      return '<mover accent="false">' + emit(node.base) + emit(node.over) + '</mover>';
    }
    return '<munder accentunder="false">' + emit(node.base) + emit(node.under) + '</munder>';
  }

  function emitFence(node) {
    var html = '<mrow>';
    if (node.left !== null && node.left !== undefined) {
      html += '<mo fence="true" stretchy="true">' + esc(node.left) + '</mo>';
    }
    html += emit(node.body);
    if (node.right !== null && node.right !== undefined) {
      html += '<mo fence="true" stretchy="true">' + esc(node.right) + '</mo>';
    }
    return html + '</mrow>';
  }

  function emitTable(node) {
    var rows = node.rows || [];
    var columnCount = 0;
    var r;
    var c;
    for (r = 0; r < rows.length; r += 1) columnCount = Math.max(columnCount, rows[r].length);
    if (!columnCount) return '';
    var columnAligns = [];
    for (c = 0; c < columnCount; c += 1) {
      if (node.aligns && node.aligns.length) columnAligns.push(node.aligns[c % node.aligns.length]);
      else columnAligns.push(node.align || 'center');
    }
    var html = '<mtable columnalign="' + columnAligns.join(' ') + '"' +
      (activeDisplay ? ' displaystyle="true"' : '') + '>';
    for (r = 0; r < rows.length; r += 1) {
      html += '<mtr>';
      for (c = 0; c < columnCount; c += 1) {
        var cell = rows[r][c];
        html += '<mtd>' + (cell ? emit(cell) : '') + '</mtd>';
      }
      html += '</mtr>';
    }
    html += '</mtable>';
    if (node.left || node.right) {
      var wrapped = '<mrow>';
      if (node.left) wrapped += '<mo fence="true" stretchy="true">' + esc(node.left) + '</mo>';
      wrapped += html;
      if (node.right) wrapped += '<mo fence="true" stretchy="true">' + esc(node.right) + '</mo>';
      html = wrapped + '</mrow>';
    }
    return html;
  }

  function buildMathML(tex, displayMode) {
    var parser = new Parser(tex, displayMode);
    activeDisplay = displayMode;
    var row = parser.parseAll();
    var inner = emit(row);
    if (parser.tag) {
      inner += '<mspace width="2em"/><mtext>(' + esc(parser.tag) + ')</mtext>';
    }
    activeDisplay = false;
    return '<math xmlns="http://www.w3.org/1998/Math/MathML"' +
      (displayMode ? ' display="block"' : '') + '>' + inner + '</math>';
  }

  /** Convert TeX to a MathML document string; null when the input is unusable. */
  function toMathML(tex, displayMode) {
    var value = String(tex == null ? '' : tex);
    if (value.length > MAX_TEX_LENGTH) return null;
    try {
      return buildMathML(value, !!displayMode);
    } catch (err) {
      activeDisplay = false;
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Rasterizer: measure the MathML, render it inside an SVG <foreignObject>,
  // decode that SVG into an <img> and paint it on a canvas. The canvas is what
  // the export engine draws into the share card (PNG and PDF both).
  // -------------------------------------------------------------------------
  function domAvailable() {
    return typeof document !== 'undefined' && document !== null &&
      typeof document.createElement === 'function' && !!document.body;
  }

  function measureMarkup(markup, doc) {
    var container = doc.createElement('div');
    container.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;' +
      'font-size:' + BASE_FONT + 'px;line-height:1;white-space:nowrap';
    container.innerHTML = '<span style="display:inline-block;width:0;height:0;vertical-align:baseline"></span>' +
      '<span style="display:inline-block;vertical-align:baseline">' + markup + '</span>';
    doc.body.appendChild(container);
    try {
      var probe = container.firstChild.getBoundingClientRect();
      var math = container.querySelector ? container.querySelector('math') : null;
      if (!math && container.lastChild && container.lastChild.firstChild) {
        math = container.lastChild.firstChild;
      }
      if (!math) return null;
      var rect = math.getBoundingClientRect();
      var ascent = probe.bottom - rect.top;
      var descent = rect.bottom - probe.bottom;
      return {
        width: rect.width, height: rect.height,
        ascent: ascent > 0 ? ascent : 0,
        descent: descent > 0 ? descent : 0
      };
    } finally {
      if (container.parentNode) container.parentNode.removeChild(container);
    }
  }

  function buildSvg(markup, width, height) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
      '" viewBox="0 0 ' + width + ' ' + height + '">' +
      '<foreignObject x="0" y="0" width="' + width + '" height="' + height + '">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:' + PAD + 'px;' +
      'box-sizing:border-box;width:' + width + 'px;height:' + height + 'px;' +
      'display:flex;align-items:flex-start;justify-content:flex-start;' +
      'font-size:' + BASE_FONT + 'px;line-height:1;white-space:nowrap;color:#1F2328">' +
      markup + '</div></foreignObject></svg>';
  }

  /** Rasterise one formula; resolves null instead of rejecting on any failure. */
  function rasterOne(doc, job) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = null;
      function finish(entry) {
        if (settled) return;
        settled = true;
        if (timer !== null) {
          try { clearTimeout(timer); } catch (err) { /* ignore */ }
        }
        resolve(entry);
      }
      var measured;
      try {
        measured = measureMarkup(job.markup, doc);
      } catch (err) {
        finish(null);
        return;
      }
      if (!measured || !(measured.width > 0) || !(measured.height > 0)) {
        finish(null);
        return;
      }
      var width = Math.ceil(measured.width) + PAD * 2;
      var height = Math.ceil(measured.height) + PAD * 2;
      var svg = buildSvg(job.markup, width, height);
      var img;
      try {
        img = doc.createElement('img');
      } catch (err) {
        finish(null);
        return;
      }
      if (!img || typeof img !== 'object') {
        finish(null);
        return;
      }
      img.onload = function () {
        try {
          var canvas = doc.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          var ctx = canvas.getContext('2d');
          if (!ctx) { finish(null); return; }
          ctx.drawImage(img, 0, 0, width, height);
          finish({
            canvas: canvas, width: width, height: height,
            cssW: measured.width, cssH: measured.height,
            ascent: measured.ascent, descent: measured.descent,
            pad: PAD, baseFont: BASE_FONT
          });
        } catch (err) {
          finish(null);
        }
      };
      img.onerror = function () { finish(null); };
      try {
        timer = setTimeout(function () { finish(null); }, RASTER_TIMEOUT);
      } catch (err) {
        timer = null;
      }
      try {
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      } catch (err) {
        finish(null);
      }
    });
  }

  /**
   * Rasterise unique formulas sequentially.
   * formulas: [{ key, tex, display }] -> Promise<Map<key, entry>>
   * `entry` = { canvas, width, height, cssW, cssH, ascent, descent, pad, baseFont }
   * Any failure drops that formula from the map (the caller falls back to the
   * raw TeX) and never rejects.
   */
  function rasterize(formulas) {
    var list = Array.isArray(formulas) ? formulas : [];
    if (!domAvailable()) return Promise.resolve(new Map());
    var doc = document;
    var unique = [];
    var seen = {};
    var i;
    for (i = 0; i < list.length && unique.length < MAX_FORMULAS; i += 1) {
      var formula = list[i] || {};
      var tex = String(formula.tex == null ? '' : formula.tex);
      if (!tex.trim() || tex.length > MAX_TEX_LENGTH) continue;
      var key = formula.key !== undefined ? formula.key
        : tex + '\u0000' + (formula.display ? '1' : '0');
      if (seen[key]) continue;
      seen[key] = true;
      var markup = null;
      try { markup = buildMathML(tex, !!formula.display); } catch (err) { markup = null; }
      if (!markup) continue;
      unique.push({ key: key, markup: markup });
    }
    var map = new Map();
    var index = 0;
    function step() {
      if (index >= unique.length) return Promise.resolve(map);
      var job = unique[index];
      index += 1;
      return rasterOne(doc, job).then(function (entry) {
        if (entry) map.set(job.key, entry);
        return step();
      }, function () {
        return step();
      });
    }
    return step().then(function (result) {
      return result;
    }, function () {
      return map;
    });
  }

  return {
    toMathML: toMathML,
    rasterize: rasterize,
    BASE_FONT: BASE_FONT,
    PAD: PAD
  };
}
