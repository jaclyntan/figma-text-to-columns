/* End-to-end exercise of the plugin against a stubbed Figma API.
   The stub models text height (lines x font size, plus paragraph spacing) so that
   layout-dependent behaviour can be asserted. */
const fs = require('fs');
const vm = require('vm');
const CODE = require('path').join(__dirname, '..', 'code.js');

const MIXED = Symbol('figma.mixed');

let failures = 0;
const ok = (name) => console.log(`ok   ${name}`);
function assert(name, cond, detail) {
  if (cond) ok(name);
  else { failures++; console.log(`FAIL ${name} ${detail === undefined ? '' : detail}`); }
}
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) ok(name);
  else { failures++; console.log(`FAIL ${name}\n  actual:   ${a}\n  expected: ${e}`); }
}

/* ------------------------------------------------------------------- stubs */

const BASE_SIZE = 12;

class FakeText {
  constructor() {
    this.type = 'TEXT';
    this.id = 'text-' + (FakeText.counter = (FakeText.counter || 0) + 1);
    this._characters = '';
    this._sizes = [];
    this.parent = null;
    this.removed = false;
    this.x = 0; this.y = 0; this.width = 200;
    this.rangeCalls = [];
    this.textAutoResize = 'NONE';
    this.hasMissingFont = false;
    this.textAlignHorizontal = 'LEFT';
    this.paragraphIndent = 0; this.paragraphSpacing = 0; this.listSpacing = 0;
    this.hangingPunctuation = false; this.hangingList = false;
    this.opacity = 1; this.blendMode = 'PASS_THROUGH';
    this.effects = []; this.strokes = []; this.strokeAlign = 'OUTSIDE';
    this.strokeWeight = 1; this.leadingTrim = 'NONE';
    this.effectStyleId = '';
    this.pluginData = {};
    this.segments = null; // only set on hand-made source nodes
  }

  get characters() { return this._characters; }
  set characters(value) {
    this._characters = value;
    this._sizes = new Array(value.length).fill(BASE_SIZE);
  }

  /**
   * Height model: lay characters out one at a time at their own size, wrapping at
   * the node width. Each line is as tall as the largest character on it, so mixed
   * type sizes affect height the way they do in Figma.
   */
  get height() {
    const paragraphs = this._characters.split('\n');
    let total = 0;
    let index = 0;

    for (const paragraph of paragraphs) {
      let lineWidth = 0;
      let lineSize = BASE_SIZE;

      for (let i = 0; i < paragraph.length; i++) {
        const size = this._sizes[index + i] || BASE_SIZE;
        const charWidth = size * 0.5;
        if (lineWidth > 0 && lineWidth + charWidth > this.width) {
          total += lineSize * 1.2;
          lineWidth = 0;
          lineSize = BASE_SIZE;
        }
        lineWidth += charWidth;
        lineSize = Math.max(lineSize, size);
      }

      total += lineSize * 1.2;
      index += paragraph.length + 1;
    }

    return total + (paragraphs.length - 1) * (this.paragraphSpacing || 0);
  }

  insertCharacters(start, characters, useStyle) {
    this._characters = this._characters.slice(0, start) + characters + this._characters.slice(start);
    const inserted = new Array(characters.length).fill(this._sizes[start - 1] || BASE_SIZE);
    this._sizes.splice.apply(this._sizes, [start, 0].concat(inserted));
  }

  record(method, start, end, value) {
    if (!(Number.isInteger(start) && Number.isInteger(end))) throw new Error(`${method}: non-integer range ${start},${end}`);
    if (start < 0 || end > this._characters.length || start >= end) {
      throw new Error(`${method}: bad range ${start}-${end} on length ${this._characters.length}`);
    }
    this.rangeCalls.push({ method, start, end, value });
  }
  setRangeFontName(s, e, v) { this.record('fontName', s, e, v); }
  setRangeFontSize(s, e, v) {
    this.record('fontSize', s, e, v);
    for (let i = s; i < e; i++) this._sizes[i] = v;
  }
  setRangeTextCase(s, e, v) { this.record('textCase', s, e, v); }
  setRangeTextDecoration(s, e, v) { this.record('textDecoration', s, e, v); }
  setRangeLineHeight(s, e, v) { this.record('lineHeight', s, e, v); }
  setRangeLetterSpacing(s, e, v) { this.record('letterSpacing', s, e, v); }
  setRangeFills(s, e, v) { this.record('fills', s, e, v); }
  setRangeIndentation(s, e, v) { this.record('indentation', s, e, v); }
  setRangeListOptions(s, e, v) { this.record('listOptions', s, e, v); }
  setRangeHyperlink(s, e, v) { this.record('hyperlink', s, e, v); }
  async setRangeTextStyleIdAsync(s, e, v) { this.record('textStyleId', s, e, v); }
  async setRangeFillStyleIdAsync(s, e, v) { this.record('fillStyleId', s, e, v); }
  async setEffectStyleIdAsync(v) { this.effectStyleId = v; }

  /** Rebuilds segments from what was actually applied, so reflow can read them back. */
  getStyledTextSegments(fields) {
    if (this.segments) return this.segments;

    const base = {
      fontName: { family: 'Inter', style: 'Regular' }, fontSize: BASE_SIZE,
      textCase: 'ORIGINAL', textDecoration: 'NONE',
      lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PERCENT', value: 0 },
      fills: [], textStyleId: '', fillStyleId: '',
      listOptions: { type: 'NONE' }, indentation: 0, hyperlink: null,
    };

    const per = [];
    for (let i = 0; i < this._characters.length; i++) per.push(Object.assign({}, base, { fontSize: this._sizes[i] }));
    for (const call of this.rangeCalls) {
      for (let i = call.start; i < call.end && i < per.length; i++) {
        if (call.method === 'fontName') per[i].fontName = call.value;
        else if (call.method === 'hyperlink') per[i].hyperlink = call.value;
        else if (call.method === 'listOptions') per[i].listOptions = call.value;
        else if (call.method === 'indentation') per[i].indentation = call.value;
        else if (call.method === 'textStyleId') per[i].textStyleId = call.value;
        else if (call.method === 'fillStyleId') per[i].fillStyleId = call.value;
        else if (call.method === 'fills') per[i].fills = call.value;
      }
    }

    const segments = [];
    const key = (p) => JSON.stringify(p);
    let start = 0;
    for (let i = 1; i <= per.length; i++) {
      if (i < per.length && key(per[i]) === key(per[start])) continue;
      segments.push(Object.assign({}, per[start], {
        start, end: i, characters: this._characters.slice(start, i),
      }));
      start = i;
    }
    return segments;
  }

  resize(w) { this.width = w; }
  getPluginData(key) { return this.pluginData[key] || ''; }
  setPluginData(key, value) { this.pluginData[key] = value; }
  get absoluteBoundingBox() {
    var x = this.x, y = this.y, p = this.parent;
    while (p && p.type !== 'PAGE') { x += p.x || 0; y += p.y || 0; p = p.parent; }
    return { x: x, y: y, width: this.width, height: this.height };
  }
  remove() {
    this.removed = true;
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
  }
}

class FakeFrame {
  constructor() {
    this.type = 'FRAME';
    this.id = 'frame-' + (FakeFrame.counter = (FakeFrame.counter || 0) + 1);
    this.children = [];
    this.parent = null;
    this.removed = false;
    this.x = 0; this.y = 0; this.width = 100;
    this.layoutMode = 'NONE';
    this.pluginData = {};
    this.relaunchData = null;
  }
  get height() { return this.children.reduce((m, c) => Math.max(m, c.height || 0), 0); }
  appendChild(node) {
    if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
    node.parent = this;
    this.children.push(node);
  }
  resize(w) { this.width = w; }
  get absoluteBoundingBox() {
    var x = this.x, y = this.y, p = this.parent;
    while (p && p.type !== 'PAGE') { x += p.x || 0; y += p.y || 0; p = p.parent; }
    return { x: x, y: y, width: this.width, height: this.height };
  }
  getPluginData(key) { return this.pluginData[key] || ''; }
  setPluginData(key, value) { this.pluginData[key] = value; }
  setRelaunchData(data) { this.relaunchData = data; }
  remove() {
    this.removed = true;
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
  }
}

function makeEnv(options) {
  const opts = options || {};
  const page = new FakeFrame();
  page.type = 'PAGE';
  const notifications = [];
  const created = { frames: [], texts: [] };
  const handlers = {};
  let closed = false;

  const figma = {
    mixed: MIXED,
    editorType: 'figma',
    currentPage: page,
    ui: { postMessage() {}, resize() {}, onmessage: null },
    clientStorage: { getAsync: async () => opts.stored || null, setAsync: async () => {} },
    parameters: { on() {} },
    showUI() {},
    on(type, fn) { handlers[type] = fn; },
    notify(message, o) { notifications.push({ message, error: !!(o && o.error) }); },
    commitUndo() {},
    closePlugin() { closed = true; },
    viewport: { scrollAndZoomIntoView() {} },
    createFrame() { const f = new FakeFrame(); page.appendChild(f); created.frames.push(f); return f; },
    createText() { const t = new FakeText(); page.appendChild(t); created.texts.push(t); return t; },
    loadFontAsync: async (font) => {
      if (opts.missingFonts && opts.missingFonts.indexOf(font.family + ' ' + font.style) !== -1) {
        throw new Error('font not available');
      }
    },
  };
  page.selection = [];

  const context = vm.createContext({
    figma, __html__: '', console,
    Int32Array, Promise, Math, Array, Symbol, isFinite, parseFloat, String, Map, Set,
    Infinity, JSON, Number, Object, Error,
  });
  vm.runInContext(fs.readFileSync(CODE, 'utf8'), context);
  return { figma, page, notifications, created, context, handlers, isClosed: () => closed };
}

function sourceText(characters, segments) {
  const node = new FakeText();
  node.characters = characters;
  node.x = 10; node.y = 20; node.width = 300;
  node.segments = segments || [{
    start: 0, end: characters.length, characters,
    fontName: { family: 'Inter', style: 'Regular' }, fontSize: BASE_SIZE,
    textCase: 'ORIGINAL', textDecoration: 'NONE',
    lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PERCENT', value: 0 },
    fills: [], textStyleId: '', fillStyleId: '',
    listOptions: { type: 'NONE' }, indentation: 0, hyperlink: null,
  }];
  return node;
}

const settings = (over) => Object.assign({
  columnCount: 3, widthType: 'column', width: 350, columnGutter: 50,
  priority: 'evenness', removeLinebreaks: true,
}, over || {});

function selectSource(env, node) {
  env.page.appendChild(node);
  env.page.selection = [node];
  return node;
}

const columnsOf = (frame) => frame.children.filter((c) => c.type === 'TEXT');

/* ------------------------------------------------------------------- tests */

(async () => {
  const body = Array.from({ length: 240 }, (_, i) => `word${i}`).join(' ');

  /* --- happy path ------------------------------------------------------- */
  {
    const env = makeEnv();
    const src = selectSource(env, sourceText(body));
    await env.context.createFromSelection(settings());

    const frame = env.created.frames[0];
    assert('one frame created', env.created.frames.length === 1);
    assert('frame holds 3 columns', columnsOf(frame).length === 3, columnsOf(frame).length);
    assert('no text lost', columnsOf(frame).map((c) => c.characters).join(' ') === body);
    assert('frame placed beside the source', frame.x === 10 + 300 + 50 && frame.y === 20);
    assert('no error notifications', !env.notifications.some((n) => n.error), JSON.stringify(env.notifications));
    assert('no text left loose on the page',
      !env.created.texts.some((t) => !t.removed && t.parent === env.page),
      JSON.stringify(env.created.texts.filter((t) => !t.removed).map((t) => t.parent && t.parent.type)));
    assert('frame is stamped for reflow', !!frame.getPluginData('textToColumns'));
    assert('relaunch button added', !!frame.relaunchData && !!frame.relaunchData.reflow);
  }

  /* --- mixed type sizes still split cleanly ---------------------------- */
  {
    // Splitting is by character count, so mixed sizes must not disturb it.
    const text = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const half = Math.floor(text.length / 2);
    const font = { family: 'Inter', style: 'Regular' };
    const base = {
      fontName: font, textCase: 'ORIGINAL', textDecoration: 'NONE',
      lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PERCENT', value: 0 },
      fills: [], textStyleId: '', fillStyleId: '',
      listOptions: { type: 'NONE' }, indentation: 0, hyperlink: null,
    };
    const segs = [
      Object.assign({ start: 0, end: half, characters: text.slice(0, half), fontSize: 32 }, base),
      Object.assign({ start: half, end: text.length, characters: text.slice(half), fontSize: 8 }, base),
    ];

    const env = makeEnv();
    selectSource(env, sourceText(text, segs));
    await env.context.createFromSelection(settings({ columnCount: 2 }));

    const cols = columnsOf(env.created.frames[0]);
    assert('mixed sizes still give 2 columns', cols.length === 2);

    const lengths = cols.map((c) => c.characters.length);
    const spread = Math.abs(lengths[0] - lengths[1]) / Math.max(lengths[0], lengths[1]);
    assert(`columns even by character count (spread ${(spread * 100).toFixed(1)}%)`, spread < 0.05,
      JSON.stringify(lengths));
    assert('mixed sizes preserved in the columns',
      cols.some((c) => c.rangeCalls.some((r) => r.method === 'fontSize' && r.value === 32)) &&
      cols.some((c) => c.rangeCalls.some((r) => r.method === 'fontSize' && r.value === 8)));
  }

  /* --- links, lists and indentation survive ----------------------------- */
  {
    const text = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet';
    const link = { type: 'URL', value: 'https://example.com' };
    const base = {
      fontName: { family: 'Inter', style: 'Regular' }, fontSize: BASE_SIZE,
      textCase: 'ORIGINAL', textDecoration: 'NONE',
      lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PERCENT', value: 0 },
      fills: [], textStyleId: '', fillStyleId: '',
    };
    // A link on the last word, a list on the first stretch.
    const linkStart = text.indexOf('juliet');
    const segs = [
      Object.assign({ start: 0, end: linkStart, characters: text.slice(0, linkStart), hyperlink: null,
        listOptions: { type: 'UNORDERED' }, indentation: 1 }, base),
      Object.assign({ start: linkStart, end: text.length, characters: text.slice(linkStart), hyperlink: link,
        listOptions: { type: 'NONE' }, indentation: 0 }, base),
    ];

    const env = makeEnv();
    selectSource(env, sourceText(text, segs));
    await env.context.createFromSelection(settings({ columnCount: 2 }));

    const cols = columnsOf(env.created.frames[0]);
    const allCalls = cols.reduce((acc, c) => acc.concat(c.rangeCalls), []);
    assert('hyperlink re-applied', allCalls.some((r) => r.method === 'hyperlink' && r.value === link));
    assert('list options re-applied', allCalls.some((r) => r.method === 'listOptions' && r.value.type === 'UNORDERED'));
    assert('indentation re-applied', allCalls.some((r) => r.method === 'indentation' && r.value === 1));

    const linkedColumn = cols.filter((c) => c.characters.indexOf('juliet') !== -1)[0];
    const linkCall = linkedColumn.rangeCalls.filter((r) => r.method === 'hyperlink')[0];
    check('link lands on the right characters',
      linkedColumn.characters.slice(linkCall.start, linkCall.end), 'juliet');
  }

  /* --- text styles go through the async API ----------------------------- */
  {
    const text = 'one two three four five six seven eight';
    const base = {
      fontName: { family: 'Inter', style: 'Regular' }, fontSize: BASE_SIZE,
      textCase: 'ORIGINAL', textDecoration: 'NONE',
      lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PERCENT', value: 0 },
      fills: [], fillStyleId: 'S:fill', listOptions: { type: 'NONE' }, indentation: 0, hyperlink: null,
    };
    const segs = [Object.assign({ start: 0, end: text.length, characters: text, textStyleId: 'S:body' }, base)];

    const env = makeEnv();
    selectSource(env, sourceText(text, segs));
    await env.context.createFromSelection(settings({ columnCount: 2 }));

    const cols = columnsOf(env.created.frames[0]);
    const calls = cols.reduce((acc, c) => acc.concat(c.rangeCalls), []);
    assert('text style applied', calls.some((r) => r.method === 'textStyleId' && r.value === 'S:body'));
    assert('fill style applied', calls.some((r) => r.method === 'fillStyleId' && r.value === 'S:fill'));
    assert('raw font not applied when a text style covers the range',
      !calls.some((r) => r.method === 'fontName'));
  }

  /* --- reflow round trip ------------------------------------------------ */
  {
    const env = makeEnv();
    selectSource(env, sourceText(body));
    await env.context.createFromSelection(settings({ columnCount: 3 }));

    const frame = env.created.frames[0];
    const before = columnsOf(frame).map((c) => c.characters).join(' ');
    const framePosition = { x: frame.x, y: frame.y };

    env.page.selection = [frame];
    await env.context.reflowSelection(settings({ columnCount: 5 }));

    const after = columnsOf(frame);
    assert('reflow changes the column count', after.length === 5, after.length);
    assert('reflow keeps every character', after.map((c) => c.characters).join(' ') === before);
    assert('reflow reuses the same frame', env.created.frames.length === 1);
    assert('reflow keeps the frame position', frame.x === framePosition.x && frame.y === framePosition.y);
    assert('old columns removed', frame.children.every((c) => !c.removed));
  }

  /* --- reflow picks up edits made in the columns ------------------------ */
  {
    const env = makeEnv();
    selectSource(env, sourceText('alpha bravo charlie delta echo foxtrot golf hotel'));
    await env.context.createFromSelection(settings({ columnCount: 2 }));

    const frame = env.created.frames[0];
    const first = columnsOf(frame)[0];
    first.characters = first.characters + ' INSERTED';

    env.page.selection = [frame];
    await env.context.reflowSelection(settings({ columnCount: 2 }));

    const text = columnsOf(frame).map((c) => c.characters).join(' ');
    assert('reflow picks up edits made in a column', text.indexOf('INSERTED') !== -1, text);
  }

  /* --- reflow leaves foreign children alone ----------------------------- */
  {
    const env = makeEnv();
    selectSource(env, sourceText(body));
    await env.context.createFromSelection(settings({ columnCount: 2 }));

    const frame = env.created.frames[0];
    const decoration = new FakeFrame();
    frame.appendChild(decoration);

    env.page.selection = [frame];
    await env.context.reflowSelection(settings({ columnCount: 3 }));

    assert('non-text children survive a reflow', frame.children.indexOf(decoration) !== -1);
    assert('reflow still produced 3 columns', columnsOf(frame).length === 3);
  }

  /* --- headings do not get a column to themselves --------------------- */
  {
    const paragraph = 'body '.repeat(30).trim();
    const heading = 'A Heading';
    const text = [paragraph, heading, paragraph, paragraph].join('\n');
    const base = {
      fontName: { family: 'Inter', style: 'Regular' },
      textCase: 'ORIGINAL', textDecoration: 'NONE',
      lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PERCENT', value: 0 },
      fills: [], textStyleId: '', fillStyleId: '',
      listOptions: { type: 'NONE' }, indentation: 0, hyperlink: null,
    };
    const headingStart = text.indexOf(heading);
    const headingEnd = headingStart + heading.length;
    const segs = [
      Object.assign({ start: 0, end: headingStart, characters: text.slice(0, headingStart), fontSize: 12 }, base),
      Object.assign({ start: headingStart, end: headingEnd, characters: heading, fontSize: 28 }, base),
      Object.assign({ start: headingEnd, end: text.length, characters: text.slice(headingEnd), fontSize: 12 }, base),
    ];

    const env = makeEnv();
    selectSource(env, sourceText(text, segs));
    await env.context.createFromSelection(settings({ columnCount: 2, priority: 'paragraphs' }));

    const cols = columnsOf(env.created.frames[0]);
    assert('paragraph mode gives 2 columns', cols.length === 2, cols.length);
    assert('no column holds only the heading', !cols.some((c) => c.characters.trim() === heading),
      JSON.stringify(cols.map((c) => c.characters.slice(0, 30))));
    const lengths = cols.map((c) => c.characters.length);
    assert('columns stay roughly even', Math.min.apply(null, lengths) > Math.max.apply(null, lengths) * 0.4,
      JSON.stringify(lengths));
  }

  /* --- quick action parameters ----------------------------------------- */
  {
    const env = makeEnv();
    selectSource(env, sourceText(body));
    await env.handlers.run({ command: undefined, parameters: { columns: '4', width: '200' } });

    const frame = env.created.frames[0];
    assert('parameters create columns without the window', columnsOf(frame).length === 4, columnsOf(frame).length);
    assert('parameter width honoured', columnsOf(frame)[0].width === 200);
    assert('plugin closes after a parameter run', env.isClosed());
  }

  /* --- relaunch button re-balances -------------------------------------- */
  {
    const env = makeEnv();
    selectSource(env, sourceText(body));
    await env.context.createFromSelection(settings({ columnCount: 3 }));

    const frame = env.created.frames[0];
    columnsOf(frame)[0].characters = 'tiny';

    env.page.selection = [frame];
    await env.handlers.run({ command: 'reflow', parameters: undefined });

    assert('relaunch re-balances in place', columnsOf(frame).length === 3, columnsOf(frame).length);
    assert('relaunch closes the plugin', env.isClosed());
  }

  /* --- every character of a reflowed column keeps its styling ----------- */
  {
    const paragraphs = Array.from({ length: 12 }, (_, i) =>
      `Paragraph ${i} ` + 'filler words here '.repeat(8).trim()).join('\n');

    const env = makeEnv();
    selectSource(env, sourceText(paragraphs));
    await env.context.createFromSelection(settings({ columnCount: 2, priority: 'paragraphs' }));
    const frame = env.created.frames[0];

    env.page.selection = [frame];
    await env.context.reflowSelection(settings({ columnCount: 3, priority: 'evenness' }));

    // The whitespace joining two columns must carry styling across a re-split,
    // or it lands mid-column in the fallback font.
    const gaps = columnsOf(frame).map((column) => {
      const covered = new Array(column.characters.length).fill(false);
      for (const call of column.rangeCalls) {
        if (call.method === 'fontName' || call.method === 'textStyleId') {
          for (let i = call.start; i < call.end; i++) covered[i] = true;
        }
      }
      return covered.filter((c) => !c).length;
    });
    check('no unstyled characters after a reflow', gaps, [0, 0, 0]);
  }

  /* --- reflow keeps styling applied to the frame ------------------------ */
  {
    const env = makeEnv();
    selectSource(env, sourceText(body));
    await env.context.createFromSelection(settings({ columnCount: 2 }));
    const frame = env.created.frames[0];

    frame.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
    frame.clipsContent = true;
    frame.counterAxisAlignItems = 'CENTER';
    frame.name = 'My renamed columns';

    env.page.selection = [frame];
    await env.context.reflowSelection(settings({ columnCount: 3, columnGutter: 12 }));

    assert('reflow keeps the frame fill', frame.fills.length === 1);
    assert('reflow keeps clipsContent', frame.clipsContent === true);
    assert('reflow keeps the alignment', frame.counterAxisAlignItems === 'CENTER');
    assert('reflow keeps the frame name', frame.name === 'My renamed columns');
    assert('reflow still applies the gutter setting', frame.itemSpacing === 12, frame.itemSpacing);
  }

  /* --- user text inside the frame is left alone ------------------------- */
  {
    const env = makeEnv();
    selectSource(env, sourceText(body));
    await env.context.createFromSelection(settings({ columnCount: 2 }));
    const frame = env.created.frames[0];

    const caption = new FakeText();
    caption.characters = 'A caption the user added';
    frame.appendChild(caption);

    env.page.selection = [frame];
    await env.context.reflowSelection(settings({ columnCount: 3 }));

    assert('user text is not deleted by a reflow', !caption.removed && caption.parent === frame);
    assert('user text is not folded into the columns',
      !columnsOf(frame).some((c) => c !== caption && c.characters.indexOf('A caption') !== -1));
    const rebuilt = columnsOf(frame).filter((c) => c !== caption);
    assert('reflow still produced 3 columns', rebuilt.length === 3, rebuilt.length);
    assert('no text lost around the user text', rebuilt.map((c) => c.characters).join(' ') === body);
  }

  /* --- repeated reflows must not drift the text ------------------------- */
  {
    for (const priority of ['paragraphs', 'evenness']) {
      const text = Array.from({ length: 10 }, (_, i) =>
        `Para ${i} ` + 'some words '.repeat(9).trim()).join('\n\n');

      const env = makeEnv();
      selectSource(env, sourceText(text));
      await env.context.createFromSelection(settings({ columnCount: 3, priority }));
      const frame = env.created.frames[0];
      env.page.selection = [frame];

      const snapshots = [];
      const shapes = [];
      for (let i = 0; i < 4; i++) {
        const data = JSON.parse(frame.getPluginData('textToColumns'));
        const cols = columnsOf(frame);
        snapshots.push(cols.map((c) => c.characters)
          .reduce((a, c, j) => (j === 0 ? c : a + data.separators[j - 1] + c), ''));
        shapes.push(cols.map((c) => c.characters.length).join(','));
        await env.context.reflowSelection(settings({ columnCount: 3, priority }));
      }

      assert(`${priority}: text identical across 4 reflows`,
        snapshots.every((s) => s === snapshots[0]),
        JSON.stringify(snapshots.map((s) => s.length)));
      assert(`${priority}: column boundaries settle`,
        shapes.every((s) => s === shapes[0]), JSON.stringify(shapes));
    }
  }

  /* --- what gets written into the document ------------------------------ */
  {
    // Figma's review asks what a plugin stores. The frame keeps its settings and
    // the whitespace between columns — never any of the user's words.
    const text = 'Alpha beta gamma.\n\n  Delta epsilon zeta.\tEta theta iota kappa lambda.';
    const env = makeEnv();
    selectSource(env, sourceText(text));
    await env.context.createFromSelection(settings({ columnCount: 3, priority: 'evenness' }));

    const frame = env.created.frames[0];
    const stored = JSON.parse(frame.getPluginData('textToColumns'));

    check('stored keys are only version, settings and separators',
      Object.keys(stored).sort(), ['separators', 'settings', 'version']);
    check('stored settings are only the six known fields',
      Object.keys(stored.settings).sort(),
      ['columnCount', 'columnGutter', 'priority', 'removeLinebreaks', 'width', 'widthType']);
    assert('separators hold whitespace only, never words',
      stored.separators.every((sep) => /^[\s\u2028\u2029]*$/.test(sep)),
      JSON.stringify(stored.separators));
    assert('each column is marked as ours',
      columnsOf(frame).every((c) => c.getPluginData('textToColumns') === 'column'));
  }

  /* --- placement across editor surfaces --------------------------------- */
  {
    // Figma Slides and Buzz hold a grid of slides/assets at page level, so the
    // columns have to land inside the slide, not loose on the page.
    const env = makeEnv();
    env.figma.editorType = 'slides';

    const slide = new FakeFrame();
    slide.type = 'SLIDE';
    slide.x = 400; slide.y = 200;
    env.page.appendChild(slide);

    const src = sourceText(body);
    src.x = 40; src.y = 30;
    slide.appendChild(src);
    env.page.selection = [src];

    await env.context.createFromSelection(settings({ columnCount: 2 }));
    const frame = env.created.frames.filter((f) => f !== slide)[0];

    assert('columns land on the slide, not the page', frame.parent === slide,
      frame.parent && frame.parent.type);
    assert('columns positioned relative to the slide',
      frame.x === src.x + src.width + 50 && frame.y === src.y,
      frame.x + ',' + frame.y);
  }

  /* --- nested auto layout walks up to a usable container ---------------- */
  {
    const env = makeEnv();
    const card = new FakeFrame();
    card.x = 100; card.y = 60;
    env.page.appendChild(card);

    const stack = new FakeFrame();
    stack.layoutMode = 'VERTICAL';
    stack.x = 10; stack.y = 10;
    card.appendChild(stack);

    const src = sourceText(body);
    src.x = 5; src.y = 5;
    stack.appendChild(src);
    env.page.selection = [src];

    await env.context.createFromSelection(settings({ columnCount: 2 }));
    const frame = env.created.frames.filter((f) => f !== card && f !== stack)[0];

    assert('auto layout is skipped but the card is used', frame.parent === card,
      frame.parent && frame.parent.type);
    assert('the auto layout stack is undisturbed', stack.children.length === 1);
  }

  /* --- failure paths leave nothing behind ------------------------------- */
  {
    const env = makeEnv();
    env.page.selection = [];
    await env.context.createFromSelection(settings());
    assert('no selection: nothing created', env.created.frames.length === 0 && env.created.texts.length === 0);
    assert('no selection: error notified', env.notifications.some((n) => n.error));
  }
  {
    const env = makeEnv();
    selectSource(env, sourceText('   '));
    await env.context.createFromSelection(settings());
    assert('empty text: nothing created', env.created.frames.length === 0);
    assert('empty text: error notified', env.notifications.some((n) => n.error));
  }
  {
    const env = makeEnv();
    const src = selectSource(env, sourceText(body));
    src.hasMissingFont = true;
    await env.context.createFromSelection(settings());
    assert('missing font: nothing created', env.created.frames.length === 0);
    assert('missing font: error notified', env.notifications.some((n) => n.error));
  }
  {
    const env = makeEnv();
    selectSource(env, sourceText(body));
    await env.context.createFromSelection(settings({ widthType: 'container', width: 100, columnGutter: 50 }));
    assert('narrow container: nothing created', env.created.frames.length === 0);
    assert('narrow container: error notified', env.notifications.some((n) => n.error));
  }
  {
    const env = makeEnv();
    env.page.selection = [];
    await env.context.reflowSelection(null);
    assert('reflow without a column frame is refused', env.notifications.some((n) => n.error));
  }

  /* --- container width -------------------------------------------------- */
  {
    const env = makeEnv();
    selectSource(env, sourceText(body));
    await env.context.createFromSelection(settings({ widthType: 'container', width: 900, columnGutter: 40 }));
    const frame = env.created.frames[0];
    assert('container: frame fixed to the given width', frame.width === 900, frame.width);
    assert('container: children fill', columnsOf(frame).every((c) => c.layoutSizingHorizontal === 'FILL'));
  }

  /* --- unloadable font falls back --------------------------------------- */
  {
    const env = makeEnv({ missingFonts: ['Comic Sans Regular'] });
    const src = sourceText(body);
    src.segments[0].fontName = { family: 'Comic Sans', style: 'Regular' };
    selectSource(env, src);
    await env.context.createFromSelection(settings({ columnCount: 2 }));
    const cols = columnsOf(env.created.frames[0]);
    assert('unloadable font still produces columns', cols.length === 2);
    assert('unloadable font swapped for the fallback',
      cols[0].rangeCalls.filter((r) => r.method === 'fontName').every((r) => r.value.family === 'Inter'));
  }

  /* --- auto layout parent is skipped ------------------------------------ */
  {
    const env = makeEnv();
    const auto = new FakeFrame();
    auto.layoutMode = 'VERTICAL';
    env.page.appendChild(auto);
    const src = sourceText(body);
    auto.appendChild(src);
    env.page.selection = [src];
    await env.context.createFromSelection(settings({ columnCount: 2 }));
    const frame = env.created.frames.filter((f) => f !== auto)[0];
    assert('auto layout parent is skipped', frame.parent === env.page, frame.parent && frame.parent.type);
    assert('auto layout: source not disturbed', auto.children.length === 1);
  }

  /* --- more columns than the text can fill ------------------------------ */
  {
    const env = makeEnv();
    selectSource(env, sourceText('one two three'));
    await env.context.createFromSelection(settings({ columnCount: 10 }));
    const frame = env.created.frames[0];
    check('short text yields what it can', columnsOf(frame).map((c) => c.characters), ['one', 'two', 'three']);
    assert('short text warns the user', env.notifications.some((n) => /Only 3 columns/.test(n.message)),
      JSON.stringify(env.notifications));
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll end-to-end checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('THREW:', e); process.exit(1); });
