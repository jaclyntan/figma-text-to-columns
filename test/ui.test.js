/* Drives the plugin window (ui.html) in headless Chrome.
 *
 * Needs a Chrome or Chromium. It looks for one in CHROME_PATH, the usual install
 * locations, and Playwright's browser cache. With none found it skips, so this is
 * its own script (`npm run test:ui`) rather than part of `npm test`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

function findChrome() {
  const candidates = [process.env.CHROME_PATH];

  candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');

  for (const cache of [
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
  ]) {
    if (!fs.existsSync(cache)) continue;
    for (const dir of fs.readdirSync(cache)) {
      if (!dir.startsWith('chromium_headless_shell')) continue;
      const root = path.join(cache, dir);
      for (const sub of fs.readdirSync(root)) {
        candidates.push(path.join(root, sub, 'chrome-headless-shell'));
      }
    }
  }

  return candidates.filter(Boolean).find((candidate) => fs.existsSync(candidate)) || null;
}

const chrome = findChrome();
if (!chrome) {
  console.log('skipped: no Chrome or Chromium found (set CHROME_PATH to run the window tests)');
  process.exit(0);
}

const ui = fs.readFileSync(path.join(__dirname, '..', 'ui.html'), 'utf8');

/* Runs inside the page. Each ck() is one assertion. */
const harness = `<script>
(async function () {
  var log = window.__log = [];
  var sent = [];
  var resized = [];
  var realPost = parent.postMessage.bind(parent);
  parent.postMessage = function (msg, origin) {
    var m = msg && msg.pluginMessage;
    if (m && m.type === 'create-columns') sent.push(m);
    if (m && m.type === 'resize') resized.push(m.height);
    if (m && m.type === 'request-variables') requests++;
    realPost(msg, origin);
  };
  var requests = 0;

  function ck(name, cond, detail) {
    log.push((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  <' + detail + '>'));
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function send(message) { window.postMessage({ pluginMessage: message }, '*'); return sleep(15); }
  function type(el, text) {
    el.focus();
    el.value = '';
    for (var i = 0; i < text.length; i++) {
      el.value += text[i];
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Clearing a field is an edit too, even though no character was typed.
    if (!text.length) el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function key(el, k) { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); }
  function enter() { key(document, 'Enter'); }
  function el(id) { return document.getElementById(id); }

  var count = el('column-count'), width = el('width'), gutter = el('column-gutter');
  var btn = el('create'), status = el('status'), widthType = el('width-type');
  var popover = el('popover'), search = el('popover-search');

  var SETTINGS = { columnCount: 3, widthType: 'column', width: 350, columnGutter: 50, priority: 'paragraphs', removeLinebreaks: true, widthVariableId: null, gutterVariableId: null };
  var VARS = [
    { id: 'v1', name: 'spacing/sm', collection: 'Spacing', value: 8 },
    { id: 'v2', name: 'spacing/md', collection: 'Spacing', value: 24 },
    { id: 'v3', name: 'spacing/lg', collection: 'Spacing', value: 48 },
    { id: 'v4', name: 'column/narrow', collection: 'Layout', value: 280 },
    { id: 'v5', name: 'column/wide', collection: 'Layout', value: 420 }
  ];
  var CREATE = { type: 'selection', mode: 'create', count: 1, name: 'Body', id: 'n1', width: 480 };

  await sleep(40);
  await send({ type: 'init', settings: SETTINGS, hasStoredSettings: true });
  await send(CREATE);

  /* ---- typing and clamping ------------------------------------------- */
  type(count, '12');
  ck('typing "12" into Columns is not rewritten', count.value === '12', count.value);
  type(width, '1200');
  ck('typing "1200" into Width is not rewritten', width.value === '1200', width.value);

  type(count, '1');
  ck('below-min value shows an error', /Columns must be between 2 and 50/.test(status.textContent), status.textContent);
  ck('below-min value disables the button', btn.disabled === true);
  count.dispatchEvent(new Event('blur'));
  ck('blur clamps below-min value to 2', count.value === '2', count.value);
  ck('button re-enabled after clamping', btn.disabled === false);

  type(count, '999'); count.dispatchEvent(new Event('blur'));
  ck('blur clamps above-max value to 50', count.value === '50', count.value);
  type(count, ''); count.dispatchEvent(new Event('blur'));
  ck('empty field falls back to the default', count.value === '2', count.value);

  /* ---- submitting ---------------------------------------------------- */
  sent.length = 0;
  enter();
  ck('Enter submits once', sent.length === 1, JSON.stringify(sent));
  ck('payload carries the settings', sent[0] && sent[0].columnCount === 2 && sent[0].width === 1200 && sent[0].priority === 'paragraphs', JSON.stringify(sent[0]));
  ck('payload carries no variables when none are bound', sent[0] && sent[0].widthVariableId === null && sent[0].gutterVariableId === null, JSON.stringify(sent[0]));
  ck('button disabled while busy', btn.disabled === true);
  enter();
  ck('no double submit while busy', sent.length === 1, sent.length);
  await send({ type: 'done' });
  ck('button re-enabled after done', btn.disabled === false);

  /* ---- container width ----------------------------------------------- */
  widthType.value = 'container';
  widthType.dispatchEvent(new Event('change'));
  type(count, '3'); count.dispatchEvent(new Event('blur'));
  type(width, '60');
  ck('narrow container flagged', /too narrow/.test(status.textContent), status.textContent);
  ck('narrow container disables the button', btn.disabled === true);
  sent.length = 0; enter();
  ck('narrow container blocks Enter', sent.length === 0, sent.length);

  /* ---- fill parent --------------------------------------------------- */
  widthType.value = 'fill';
  widthType.dispatchEvent(new Event('change'));
  ck('fill: the width field is disabled', width.disabled === true);
  ck('fill: the width variable button is disabled', el('width-var').disabled === true);
  ck('fill: a width that would be too narrow no longer matters', btn.disabled === false && !/narrow/.test(status.textContent), status.textContent + ' / ' + btn.disabled);
  type(gutter, '50');
  sent.length = 0; enter();
  ck('fill: submits as fill', sent.length === 1 && sent[0].widthType === 'fill', JSON.stringify(sent));
  await send({ type: 'done' });
  widthType.value = 'column';
  widthType.dispatchEvent(new Event('change'));
  ck('fill: switching back re-enables the width field', width.disabled === false);

  /* ---- variables ----------------------------------------------------- */
  type(width, '350');
  await send({ type: 'variables', variables: VARS });

  requests = 0;
  el('gutter-var').click();
  await sleep(10);
  ck('variables: the list opens', popover.hidden === false);
  ck('variables: opening asks the plugin for a fresh list', requests === 1, requests);
  ck('variables: every variable is listed', popover.querySelectorAll('.popover-row').length === 5, popover.querySelectorAll('.popover-row').length);
  ck('variables: grouped by collection', popover.querySelectorAll('.popover-group').length === 2, popover.querySelectorAll('.popover-group').length);
  ck('variables: the search field has focus', document.activeElement === search);

  type(search, 'narrow');
  ck('variables: searching filters the list', popover.querySelectorAll('.popover-row').length === 1, popover.querySelectorAll('.popover-row').length);
  type(search, 'spacing');
  ck('variables: search also matches the collection', popover.querySelectorAll('.popover-row').length === 3);
  type(search, 'nothing like this');
  ck('variables: no match says so', /No matching/.test(popover.textContent), popover.textContent);

  type(search, '');
  key(search, 'ArrowDown');
  sent.length = 0;
  key(search, 'Enter');
  ck('variables: arrow keys then Enter picks a variable', el('gutter-chip').hidden === false && el('gutter-chip-name').textContent === 'spacing/md', el('gutter-chip-name').textContent);
  ck('variables: Enter in the list does not submit the form', sent.length === 0, sent.length);
  ck('variables: the list closes after choosing', popover.hidden === true);
  ck('variables: the field shows the variable value', gutter.value === '24', gutter.value);
  ck('variables: the typed number is hidden behind the chip', el('gutter-field').classList.contains('is-bound'));

  enter();
  ck('variables: the payload carries the variable id', sent.length === 1 && sent[0].gutterVariableId === 'v2' && sent[0].columnGutter === 24, JSON.stringify(sent[0]));
  ck('variables: width stays unbound', sent[0].widthVariableId === null);
  await send({ type: 'done' });

  /* picking by mouse, on the width field */
  el('width-var').click();
  await sleep(10);
  var rows = popover.querySelectorAll('.popover-row');
  rows[3].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  ck('variables: clicking a row binds it', el('width-chip').hidden === false && width.value === '280', width.value);

  /* a bound field is not clamped or rewritten on blur */
  gutter.dispatchEvent(new Event('blur'));
  ck('variables: blur leaves a bound value alone', gutter.value === '24', gutter.value);

  /* escape closes without choosing */
  el('width-chip').querySelector('.chip-main').click();
  await sleep(10);
  ck('variables: the chip reopens the list', popover.hidden === false);
  key(search, 'Escape');
  ck('variables: Escape closes it', popover.hidden === true);
  ck('variables: Escape keeps the binding', el('width-chip').hidden === false);

  /* clicking elsewhere closes it */
  el('gutter-chip').querySelector('.chip-main').click();
  await sleep(10);
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  ck('variables: clicking outside closes the list', popover.hidden === true);

  /* detaching */
  el('gutter-chip-x').click();
  ck('variables: detach removes the chip', el('gutter-chip').hidden === true);
  ck('variables: detach keeps the number', gutter.value === '24', gutter.value);
  ck('variables: detach hands the field back to the user', document.activeElement === gutter);
  sent.length = 0; enter();
  ck('variables: the payload clears the id after detaching', sent[0] && sent[0].gutterVariableId === null && sent[0].widthVariableId === 'v4', JSON.stringify(sent[0]));
  await send({ type: 'done' });

  /* fill parent hides the width variable but keeps it */
  widthType.value = 'fill'; widthType.dispatchEvent(new Event('change'));
  el('width-var').click();
  await sleep(10);
  ck('variables: a disabled width field cannot open the list', popover.hidden === true);
  widthType.value = 'column'; widthType.dispatchEvent(new Event('change'));

  /* an empty file */
  await send({ type: 'variables', variables: [] });
  el('gutter-var').click();
  await sleep(10);
  ck('variables: an empty file explains itself', /No number variables/.test(popover.textContent), popover.textContent);
  closeAll();
  function closeAll() { key(search, 'Escape'); }
  // the width binding no longer exists in the new list, so it is dropped
  ck('variables: a binding missing from a fresh list is dropped', el('width-chip').hidden === true);
  await send({ type: 'variables', variables: VARS });

  /* ---- selecting columns restores their bindings --------------------- */
  var BOUND = Object.assign({}, SETTINGS, { columnCount: 4, width: 275, gutterVariableId: 'v3', widthVariableId: 'v5' });
  await send({ type: 'selection', mode: 'reflow', count: 1, name: 'Body — columns', id: 'f1', settings: BOUND });
  ck('reflow: the button relabels', btn.textContent === 'Update columns', btn.textContent);
  ck('reflow: stored settings are filled in', count.value === '4', count.value);
  ck('reflow: stored bindings come back', el('gutter-chip-name').textContent === 'spacing/lg' && el('width-chip-name').textContent === 'column/wide',
    el('gutter-chip-name').textContent + ' / ' + el('width-chip-name').textContent);
  sent.length = 0; enter();
  ck('reflow: submits as a reflow with the ids', sent.length === 1 && sent[0].mode === 'reflow' && sent[0].gutterVariableId === 'v3' && sent[0].widthVariableId === 'v5', JSON.stringify(sent[0]));
  await send({ type: 'done' });

  /* a variable made after the window opened: ask for a fresh list before giving up */
  await send({ type: 'variables', variables: VARS.filter(function (v) { return v.id !== 'v3' && v.id !== 'v5'; }) });
  requests = 0;
  await send({ type: 'selection', mode: 'reflow', count: 1, name: 'Other', id: 'f2', settings: BOUND });
  ck('stale list: an unknown id asks for a fresh list', requests >= 1, requests);
  ck('stale list: and is not dropped while waiting', gutter.value === '275' || el('gutter-chip').hidden === true);
  sent.length = 0; enter();
  ck('stale list: submitting meanwhile keeps the ids', sent.length === 1 && sent[0].gutterVariableId === 'v3' && sent[0].widthVariableId === 'v5', JSON.stringify(sent[0]));
  await send({ type: 'done' });
  await send({ type: 'variables', variables: VARS });
  ck('stale list: the fresh list restores the bindings', el('gutter-chip-name').textContent === 'spacing/lg' && el('width-chip-name').textContent === 'column/wide',
    el('gutter-chip-name').textContent + ' / ' + el('width-chip-name').textContent);

  /* genuinely gone: the fresh list still lacks it, so the binding goes and the number stays */
  await send({ type: 'selection', mode: 'reflow', count: 1, name: 'Third', id: 'f3', settings: Object.assign({}, BOUND, { gutterVariableId: 'deleted', columnGutter: 33 }) });
  await send({ type: 'variables', variables: VARS });
  ck('deleted: the binding is dropped once the fresh list lacks it', el('gutter-chip').hidden === true);
  ck('deleted: the stored number is kept', gutter.value === '33', gutter.value);

  /* a variable renamed in the file */
  await send({ type: 'selection', mode: 'reflow', count: 1, name: 'Fourth', id: 'f4', settings: BOUND });
  var renamed = VARS.map(function (v) { return v.id === 'v3' ? { id: 'v3', name: 'spacing/xl', collection: 'Spacing', value: 64 } : v; });
  await send({ type: 'variables', variables: renamed });
  ck('rename: a bound chip follows the new name and value', el('gutter-chip-name').textContent === 'spacing/xl' && gutter.value === '64', el('gutter-chip-name').textContent + ' ' + gutter.value);

  /* ---- several layers ------------------------------------------------ */
  await send({ type: 'selection', mode: 'create', count: 4, name: 'Body', id: 'n9' });
  ck('batch: the status counts layers', /Ready — 4 text layers/.test(status.textContent), status.textContent);
  ck('batch: the button stays "Create columns"', btn.textContent === 'Create columns');
  await send({ type: 'selection', mode: 'reflow', count: 3, name: 'x', id: 'f9' });
  ck('batch: the status counts sets of columns', /Update — 3 sets of columns/.test(status.textContent), status.textContent);
  await send({ type: 'selection', mode: 'create', count: 1, name: 'Body', id: 'n1' });
  ck('batch: one layer names it instead', /Ready — Body/.test(status.textContent), status.textContent);

  /* ---- nothing selected ---------------------------------------------- */
  await send({ type: 'selection', mode: 'none', count: 0, name: null, id: null, width: null });
  ck('none: the button is disabled', btn.disabled === true);
  ck('none: the label returns to create', btn.textContent === 'Create columns');
  sent.length = 0; enter();
  ck('none: Enter does nothing', sent.length === 0);

  /* ---- layout -------------------------------------------------------- */
  var needed = Math.ceil(document.querySelector('.actions').getBoundingClientRect().bottom + window.pageYOffset);
  ck('layout: no footer is needed to measure the height', !document.querySelector('.footer'));
  ck('layout: the content is the height the plugin opens the window at (229)', needed === 229, needed);
  ck('layout: the measured height is the height of the content', contentHeight() === needed, contentHeight() + ' vs ' + needed);
  resized.length = 0; lastPostedHeight = 0; postHeight();
  ck('layout: the window reports that height to the plugin', resized.length === 1 && resized[0] === needed, resized.join(',') + ' vs ' + needed);
  ck('layout: nothing overflows the page', document.documentElement.scrollWidth <= window.innerWidth, document.documentElement.scrollWidth + ' vs ' + window.innerWidth);

  var pre = document.createElement('pre');
  pre.id = 'results';
  pre.textContent = log.join('\\n');
  document.body.appendChild(pre);
})().catch(function (error) {
  var pre = document.createElement('pre');
  pre.id = 'results';
  pre.textContent = (window.__log || []).join('\\n') + '\\nFAIL the harness threw: ' + (error && error.stack || error);
  document.body.appendChild(pre);
});
</script>`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-ui-'));
const file = path.join(dir, 'driver.html');
fs.writeFileSync(file, ui + harness);

let dom;
try {
  dom = childProcess.execFileSync(
    chrome,
    ['--headless', '--disable-gpu', '--virtual-time-budget=8000', '--window-size=340,229', '--dump-dom', 'file://' + file],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 }
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

const match = dom.match(/<pre id="results">([\s\S]*?)<\/pre>/);
if (!match) {
  console.log('FAIL the window never finished running its checks');
  process.exit(1);
}

const results = match[1]
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
console.log(results);

const failures = results.split('\n').filter((line) => line.startsWith('FAIL')).length;
console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll window checks passed');
process.exit(failures ? 1 : 0);
