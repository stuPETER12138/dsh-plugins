/**
 * Node-only tests for src/latex.js (TeX -> MathML + formula rasterizer).
 *
 * The chunk is evaluated inside a `new Function`, so it must not touch the DOM
 * at evaluation time; rasterisation tests then use hostile document stubs to
 * prove failures degrade to "no raster" instead of breaking the export.
 *
 * Run: node tools/test-latex.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'latex.js'), 'utf8');

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

function makeEngine(scopeDocument) {
  const factory = new Function('document', source + '\nreturn createLatexEngine;');
  return factory(scopeDocument)();
}

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsAll(markup, parts) {
  return markup !== null && parts.every((part) => markup.includes(part));
}

async function main() {
  check('chunk: no import/export statements', !/^\s*(import|export)\s/m.test(source));
  check('chunk: defines top-level function createLatexEngine()', /^function createLatexEngine\(\)\s*\{/m.test(source));

  // (1) Evaluation must not touch the DOM.
  let noDomOk = false;
  let throwingEngine = null;
  try {
    const throwing = new Proxy({}, { get() { throw new Error('top-level DOM access'); } });
    throwingEngine = makeEngine(throwing);
    noDomOk = typeof throwingEngine.toMathML === 'function' &&
      typeof throwingEngine.rasterize === 'function' &&
      typeof throwingEngine.BASE_FONT === 'number' &&
      typeof throwingEngine.PAD === 'number';
  } catch (err) {
    noDomOk = false;
    console.log('   (top-level DOM check error: ' + err.message + ')');
  }
  check('engine: no DOM access at evaluation time', noDomOk);

  const engine = makeEngine(undefined);
  check('engine: exposes BASE_FONT/PAD geometry', engine.BASE_FONT === 48 && engine.PAD === 6,
    'BASE_FONT=' + engine.BASE_FONT + ' PAD=' + engine.PAD);

  // (2) Basic structures.
  const frac = engine.toMathML('\\frac{a}{b}', false);
  check('tex: fraction -> mfrac with mi children',
    containsAll(frac, ['<mfrac>', '<mi>a</mi>', '<mi>b</mi>']), frac);
  check('tex: display math gets display="block"',
    engine.toMathML('x', true).includes('display="block"'));
  check('tex: inline math has no display attribute',
    !engine.toMathML('x', false).includes('display="block"'));

  check('tex: superscript/subscript -> msubsup',
    containsAll(engine.toMathML('x_i^2', false), ['<msubsup>', '<mi>i</mi>', '<mn>2</mn>']));
  check('tex: sqrt -> msqrt and n-th root -> mroot',
    engine.toMathML('\\sqrt{x}', false).includes('<msqrt>') &&
    engine.toMathML('\\sqrt[3]{x}', false).includes('<mroot>'));
  check('tex: Greek letters map to Unicode identifiers',
    containsAll(engine.toMathML('\\alpha+\\Omega', false), ['<mi>\u03B1</mi>', '<mi>\u03A9</mi>']));
  check('tex: relations/operators map to <mo>',
    containsAll(engine.toMathML('a\\leq b\\cdot c', false), ['<mo>\u2264</mo>', '<mo>\u22C5</mo>']));
  check('tex: \\text keeps text mode content',
    containsAll(engine.toMathML('\\text{Pa}', false), ['<mtext>Pa</mtext>']));
  check('tex: CJK text survives in \\text',
    engine.toMathML('\\text{应力}', false).includes('<mtext>应力</mtext>'));
  check('tex: unknown commands degrade to visible text',
    /<mtext>\\?foo<\/mtext>/.test(engine.toMathML('\\foo{x}', false)),
    engine.toMathML('\\foo{x}', false));
  check('tex: XML special characters are escaped',
    containsAll(engine.toMathML('\\text{a&b<c}', false), ['<mtext>a&amp;b&lt;c</mtext>']),
    engine.toMathML('\\text{a&b<c}', false));
  check('tex: a stray alignment tab stays visible outside environments',
    engine.toMathML('A & B', false).includes('<mo>&amp;</mo>'), engine.toMathML('A & B', false));

  // (3) Styling commands become Unicode math-alphanumerics.
  const blackboard = engine.toMathML('\\mathbb{R}', false);
  check('tex: \\mathbb uses double-struck Unicode', blackboard.includes('\u211D'), blackboard);
  const script = engine.toMathML('\\mathcal{L}', false);
  check('tex: \\mathcal uses script Unicode', script.includes('\u2112'), script);
  const bold = engine.toMathML('\\mathbf{F}', false);
  check('tex: \\mathbf uses bold Unicode', bold.includes('\u{1D405}'), bold);

  // (4) Delimiters, environments, big operators.
  const fence = engine.toMathML('\\left(\\frac{a}{b}\\right)^2', false);
  check('tex: \\left...\\right emits stretchy fences',
    containsAll(fence, ['stretchy="true"', 'fence="true"', '<msup>']), fence);
  const matrix = engine.toMathML('\\begin{pmatrix}1&0\\\\0&1\\end{pmatrix}', true);
  check('tex: pmatrix -> mtable wrapped in parentheses',
    containsAll(matrix, ['<mtable', '<mtr>', '<mtd>', 'stretchy="true">(</mo>', 'stretchy="true">)</mo>']), matrix);
  const cases = engine.toMathML('\\begin{cases}x>0&a\\\\x\\le0&b\\end{cases}', true);
  check('tex: cases -> left-braced mtable', containsAll(cases, ['<mtable', '\u2264', '{']), cases);
  const aligned = engine.toMathML('\\begin{aligned}a&=b\\\\c&=d\\end{aligned}', true);
  check('tex: aligned -> two-column mtable with alignment',
    containsAll(aligned, ['columnalign="right left"', '<mtr>']), aligned);

  const inlineSum = engine.toMathML('\\sum_{i=1}^n i', false);
  check('tex: inline big operator uses side scripts (msubsup)', inlineSum.includes('<msubsup>'), inlineSum);
  const displaySum = engine.toMathML('\\sum_{i=1}^n i', true);
  check('tex: display big operator uses limits (munderover)', displaySum.includes('<munderover>'), displaySum);
  const lim = engine.toMathML('\\lim_{x\\to 0} f(x)', false);
  check('tex: \\lim uses under limits in all styles', lim.includes('<munder>'), lim);

  // (5) Accents, spacing, functions, negation.
  check('tex: accents -> mover/munder',
    containsAll(engine.toMathML('\\hat{x}+\\overline{AB}', false), ['<mover', 'accent="true"']));
  check('tex: spacing commands -> mspace',
    engine.toMathML('a\\,b\\quad c', false).includes('<mspace width="0.1667em"/>'));
  check('tex: function names are upright with a thin space',
    containsAll(engine.toMathML('\\sin x', false), ['<mtext>sin</mtext>', '<mspace width="0.1667em"/>']));
  check('tex: \\not= maps to the precomposed relation',
    engine.toMathML('\\not=', false).includes('<mo>\u2260</mo>'));

  // (6) Fenced math (```math) and same-line/multi-line display forms are
  // parsed by export-core; here the converter must simply accept their bodies.
  check('tex: multiline TeX input is tolerated',
    engine.toMathML('\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}', true) !== null);

  // (7) Robustness.
  check('tex: empty input still produces MathML',
    typeof engine.toMathML('', false) === 'string' && engine.toMathML('', false).includes('<math'));
  check('tex: unbalanced braces do not throw',
    typeof engine.toMathML('{unbalanced', false) === 'string');
  check('tex: over-long input is rejected with null',
    engine.toMathML('x'.repeat(7000), false) === null);
  check('tex: over-long inline scripts are rejected with null',
    engine.toMathML('$' + 'x'.repeat(7000) + '$', false) === null);

  // (8) Rasterizer without a DOM resolves an empty map (never rejects).
  const noDom = makeEngine(undefined);
  const emptyResult = await noDom.rasterize([{ key: 'k', tex: 'x', display: false }]);
  check('raster: no document -> empty map',
    emptyResult instanceof Map && emptyResult.size === 0);
  const emptyInput = await engine.rasterize([]);
  check('raster: empty formula list -> empty map', emptyInput instanceof Map && emptyInput.size === 0);

  const hostileDocument = {
    body: {},
    createElement() { throw new Error('no layout engine'); }
  };
  const hostile = makeEngine(hostileDocument);
  let hostileResult = null;
  let hostileRejected = false;
  try {
    hostileResult = await hostile.rasterize([
      { key: 'a', tex: '\\frac{1}{2}', display: false },
      { key: 'b', tex: 'x^2', display: true }
    ]);
  } catch (err) {
    hostileRejected = true;
  }
  check('raster: hostile DOM does not reject', hostileRejected === false);
  check('raster: hostile DOM -> empty map', hostileResult instanceof Map && hostileResult.size === 0);

  const mediumDocument = {
    body: { appendChild() {}, removeChild() {} },
    createElement() { throw new Error('cannot create element'); }
  };
  const medium = makeEngine(mediumDocument);
  const mediumResult = await medium.rasterize([{ key: 'a', tex: 'x', display: false }]);
  check('raster: element creation failure -> empty map', mediumResult instanceof Map && mediumResult.size === 0);

  console.log('\n' + (failed === 0 ? 'PASS' : 'FAIL') + ': ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.log('FAIL: harness crashed :: ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
