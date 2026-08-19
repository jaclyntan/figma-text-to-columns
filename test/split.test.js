/* Loads the compiled plugin code in a VM with a stubbed Figma API and exercises
   the pure text-splitting helpers. */
const fs = require('fs');
const vm = require('vm');

const LS = String.fromCharCode(0x2028); // soft return
const PS = String.fromCharCode(0x2029); // paragraph separator
const BOM = String.fromCharCode(0xfeff);

const figma = {
  mixed: Symbol('mixed'),
  editorType: 'figma',
  currentPage: { selection: [], appendChild() {} },
  ui: { postMessage() {}, resize() {} },
  clientStorage: { getAsync: async () => null, setAsync: async () => {} },
  parameters: { on() {} },
  showUI() {},
  on() {},
  notify() {},
  commitUndo() {},
  viewport: { scrollAndZoomIntoView() {} },
  createFrame() { return {}; },
  createText() { return {}; },
  loadFontAsync: async () => {},
};

const context = vm.createContext({ figma, __html__: '', console, Int32Array, Promise, Math, Array, Symbol, isFinite, parseFloat, String, Map, Set, Infinity });
vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','code.js'), 'utf8'), context);

const call = (expr) => vm.runInContext(expr, Object.assign(context, {}));
context.__test = {};

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.log(`FAIL ${name}\n  actual:   ${a}\n  expected: ${e}`);
  } else {
    console.log(`ok   ${name}`);
  }
}
function assert(name, cond, detail) {
  if (!cond) { failures++; console.log(`FAIL ${name} ${detail || ''}`); }
  else console.log(`ok   ${name}`);
}

const normalise = context.normalise;
const findBreakpoints = context.findBreakpoints;
const splitIntoRanges = context.splitIntoRanges;
const trimRanges = context.trimRanges;

assert('helpers exported into VM scope', typeof normalise === 'function' && typeof splitIntoRanges === 'function');

/* ---------------------------------------------------------------- normalise */

check('CRLF collapses to one \\n', normalise('a\r\nb', false).text, 'a\nb');
check('CRLF index map', normalise('a\r\nb', false).source, [0, 2, 3]);
check('lone CR becomes \\n', normalise('a\rb', false).text, 'a\nb');
check('paragraph separator becomes \\n', normalise('a' + PS + 'b', false).text, 'a\nb');
check('soft return preserved', normalise('a' + LS + 'b', false).text, 'a' + LS + 'b');
check('BOM dropped', normalise('a' + BOM + 'b', false).text, 'ab');
check('BOM index map', normalise('a' + BOM + 'b', false).source, [0, 2]);
check('blank lines collapse', normalise('a\n\n\nb', true).text, 'a\nb');
check('blank lines kept when off', normalise('a\n\n\nb', false).text, 'a\n\n\nb');
check('collapse prefers hard return', normalise('a' + LS + '\n' + LS + 'b', true).text, 'a\nb');
check('collapse keeps lone soft return', normalise('a' + LS + 'b', true).text, 'a' + LS + 'b');

const nz = normalise('one\r\n\r\ntwo' + PS + 'three', true);
assert('index map length matches text', nz.source.length === nz.text.length, `${nz.source.length} vs ${nz.text.length}`);
assert('index map strictly increasing', nz.source.every((v, i) => i === 0 || v > nz.source[i - 1]));

/* ------------------------------------------------------------------ splitting */

function columns(text, count, paragraphsOnly) {
  let bps = findBreakpoints(text, paragraphsOnly);
  if (paragraphsOnly && bps.length < count - 1) bps = findBreakpoints(text, false);
  return trimRanges(text, splitIntoRanges(text, count, bps)).map((r) => text.slice(r.start, r.end));
}

const words = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');

for (const n of [2, 3, 4, 5, 7, 12]) {
  const cols = columns(words, n, false);
  assert(`even split into ${n} columns`, cols.length === n, `got ${cols.length}`);
  assert(`no word split at ${n} columns`, cols.every((c) => /^word\d+/.test(c) && /word\d+$/.test(c)));
  assert(`no text lost at ${n} columns`, cols.join(' ') === words);
  const lens = cols.map((c) => c.length);
  const spread = (Math.max(...lens) - Math.min(...lens)) / (words.length / n);
  assert(`columns balanced at ${n} (spread ${spread.toFixed(3)})`, spread < 0.1);
}

const paras = ['Alpha '.repeat(40), 'Beta '.repeat(40), 'Gamma '.repeat(40), 'Delta '.repeat(40)]
  .map((p) => p.trim())
  .join('\n');

const byPara = columns(paras, 2, true);
assert('paragraph mode makes 2 columns', byPara.length === 2, `got ${byPara.length}`);
assert('paragraph mode never splits a paragraph', byPara.every((c) => !/Alpha Beta|Beta Gamma|Gamma Delta/.test(c.replace(/\n/g, ' ')) || c.split('\n').every((line) => /^(Alpha|Beta|Gamma|Delta)/.test(line))));
assert('paragraph mode keeps all text', byPara.join('\n') === paras);

// More columns than paragraphs -> caller falls back to word breakpoints.
const bpsFew = findBreakpoints(paras, true);
assert('paragraph breakpoints counted', bpsFew.length === 3, `got ${bpsFew.length}`);
const fallback = columns(paras, 6, true);
assert('falls back to words for 6 columns', fallback.length === 6, `got ${fallback.length}`);

/* --------------------------------------------------------------- edge cases */

check('single unbreakable word yields one column', columns('supercalifragilistic', 4, false), ['supercalifragilistic']);
check('empty text yields nothing', columns('   ', 3, false), []);
check('two words into 4 columns degrades gracefully', columns('one two', 4, false), ['one', 'two']);
check('three words into 50 columns', columns('a b c', 50, false), ['a', 'b', 'c']);
assert('column count larger than words never throws', columns('a b c', 50, false).length <= 3);

const trailing = columns('alpha beta   \n\n  gamma delta', 2, false);
assert('boundaries trimmed', trailing.every((c) => c === c.trim()), JSON.stringify(trailing));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
