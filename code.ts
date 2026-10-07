/**
 * Text to Columns — splits a text layer into evenly balanced columns.
 *
 * Design notes:
 * - Splitting is index based rather than regex based, so it cannot fail on unusual
 *   characters and always produces as many columns as the text can fill.
 * - Styling is copied per character from styled text segments, so mixed fonts,
 *   colours, text styles, lists and links all survive the split.
 * - The generated frame remembers how it was made, so it can be re-flowed later
 *   without deleting anything.
 */

const UI_WIDTH = 340;
/** Close to the real content height, so the window does not visibly resize on open. */
const UI_INITIAL_HEIGHT = 229;
const UI_MIN_HEIGHT = 200;
const UI_MAX_HEIGHT = 640;

const SETTINGS_KEY = 'settings';

/** Marks a frame as ours and stores what is needed to rebuild it. */
const PLUGIN_DATA_KEY = 'textToColumns';
const PLUGIN_DATA_VERSION = 1;

/** Marks the text layers inside that frame as columns rather than user content. */
const COLUMN_MARKER = 'column';

const FALLBACK_FONTS: FontName[] = [
  { family: 'Inter', style: 'Regular' },
  { family: 'Roboto', style: 'Regular' },
];

type Priority = 'paragraphs' | 'evenness';
type WidthType = 'column' | 'container' | 'fill';

interface Settings {
  columnCount: number;
  widthType: WidthType;
  width: number;
  columnGutter: number;
  priority: Priority;
  removeLinebreaks: boolean;
  /** Number variables the width and gutter are bound to, or null when typed by hand. */
  widthVariableId: string | null;
  gutterVariableId: string | null;
}

const DEFAULTS: Settings = {
  columnCount: 2,
  widthType: 'column',
  width: 350,
  columnGutter: 50,
  priority: 'paragraphs',
  removeLinebreaks: true,
  widthVariableId: null,
  gutterVariableId: null,
};

const LIMITS = {
  columnCount: { min: 2, max: 50 },
  width: { min: 1, max: 10000 },
  columnGutter: { min: 0, max: 5000 },
};

/* -------------------------------------------------------------------------- */
/* Styled segments                                                            */
/* -------------------------------------------------------------------------- */

type SegmentField =
  | 'fontSize'
  | 'fontName'
  | 'textDecoration'
  | 'textCase'
  | 'lineHeight'
  | 'letterSpacing'
  | 'fills'
  | 'textStyleId'
  | 'fillStyleId'
  | 'listOptions'
  | 'indentation'
  | 'hyperlink';

const SEGMENT_FIELDS: SegmentField[] = [
  'fontSize',
  'fontName',
  'textDecoration',
  'textCase',
  'lineHeight',
  'letterSpacing',
  'fills',
  'textStyleId',
  'fillStyleId',
  'listOptions',
  'indentation',
  'hyperlink',
];

type Segment = Pick<StyledTextSegment, SegmentField | 'characters' | 'start' | 'end'>;

const fontKey = (font: FontName) => `${font.family}\u0000${font.style}`;

/** The node level styling that is not covered by styled text segments. */
interface NodeStyle {
  textAlignHorizontal: TextNode['textAlignHorizontal'];
  // These are per paragraph, so a layer with varied spacing reports them as mixed.
  paragraphIndent: number | null;
  paragraphSpacing: number | null;
  listSpacing: number | null;
  hangingPunctuation: boolean;
  hangingList: boolean;
  opacity: number;
  blendMode: BlendMode;
  effects: ReadonlyArray<Effect>;
  effectStyleId: string;
  strokes: ReadonlyArray<Paint>;
  strokeAlign: TextNode['strokeAlign'];
  strokeWeight: number | null;
  leadingTrim: LeadingTrim | null;
}

/** Everything needed to rebuild a set of columns, wherever it was read from. */
interface SourceContent {
  name: string;
  characters: string;
  segments: Segment[];
  style: NodeStyle;
}

/* -------------------------------------------------------------------------- */
/* Text normalisation                                                         */
/* -------------------------------------------------------------------------- */

const LINE_BREAKS = '\n\u2028\u2029';
const isLineBreak = (char: string) => LINE_BREAKS.indexOf(char) !== -1;
const isWhitespace = (char: string) => char === ' ' || char === '\t' || isLineBreak(char);

interface NormalisedText {
  /** The cleaned string that gets split into columns. */
  text: string;
  /** `source[i]` is the index in the original string that `text[i]` came from. */
  source: number[];
}

/**
 * Cleans the raw string Figma returns without losing the ability to map every
 * character back to its original index (which is what keeps styling intact).
 *
 * - `\r\n` / `\r` are normalised to `\n`
 * - `\u2029` (paragraph separator) becomes `\n`; `\u2028` (soft return) is kept
 * - byte order marks are dropped
 * - runs of blank lines optionally collapse to a single break
 */
function normalise(raw: string, removeLinebreaks: boolean): NormalisedText {
  const chars: string[] = [];
  const source: number[] = [];

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];

    // Drop byte order marks / zero width no-break spaces.
    if (char === '\uFEFF') continue;

    if (char === '\r') {
      // Let the '\n' of a CRLF pair carry the break so indices stay aligned.
      if (raw[i + 1] === '\n') continue;
      chars.push('\n');
    } else if (char === '\u2029') {
      chars.push('\n');
    } else {
      chars.push(char);
    }

    source.push(i);
  }

  if (!removeLinebreaks) return { text: chars.join(''), source };

  // Collapse runs of blank lines into a single break, keeping a hard return in
  // preference to a soft one so paragraph boundaries survive.
  const collapsed: string[] = [];
  const collapsedSource: number[] = [];

  for (let i = 0; i < chars.length; i++) {
    if (!isLineBreak(chars[i])) {
      collapsed.push(chars[i]);
      collapsedSource.push(source[i]);
      continue;
    }

    let end = i;
    let hardBreak = -1;
    while (end < chars.length && isLineBreak(chars[end])) {
      if (hardBreak === -1 && chars[end] === '\n') hardBreak = end;
      end++;
    }

    const keep = hardBreak === -1 ? i : hardBreak;
    collapsed.push(chars[keep]);
    collapsedSource.push(source[keep]);
    i = end - 1;
  }

  return { text: collapsed.join(''), source: collapsedSource };
}

/* -------------------------------------------------------------------------- */
/* Splitting                                                                  */
/* -------------------------------------------------------------------------- */

type Range = { start: number; end: number };

/** Indices at which a column is allowed to start. */
function findBreakpoints(text: string, paragraphsOnly: boolean): number[] {
  const points: number[] = [];

  for (let i = 1; i < text.length; i++) {
    const current = text[i];
    const previous = text[i - 1];

    if (paragraphsOnly) {
      // Only a hard return starts a new paragraph; soft returns stay inside one.
      if (previous === '\n' && current !== '\n') points.push(i);
    } else if (isWhitespace(previous) && !isWhitespace(current)) {
      points.push(i);
    }
  }

  return points;
}

/**
 * Cuts the text at the breakpoints closest to an even split, always leaving
 * enough breakpoints for the columns that still have to be filled.
 */
function splitIntoRanges(text: string, columnCount: number, breakpoints: number[]): Range[] {
  const ranges: Range[] = [];
  let start = 0;
  let nextBreakpoint = 0;

  // There can never be more columns than breakpoints allow; asking for more just
  // yields as many as the text can fill.
  const total = Math.max(1, Math.min(columnCount, breakpoints.length + 1));

  for (let column = 1; column < total; column++) {
    const target = Math.round((text.length * column) / total);
    // Reserve one breakpoint for each column that still has to be filled.
    const lastUsable = breakpoints.length - (total - column);

    let chosen = -1;
    let chosenIndex = -1;
    let chosenDistance = Infinity;

    for (let i = nextBreakpoint; i <= lastUsable; i++) {
      const point = breakpoints[i];
      if (point <= start) continue;

      const distance = Math.abs(point - target);
      if (distance < chosenDistance) {
        chosen = point;
        chosenIndex = i;
        chosenDistance = distance;
      } else if (point > target) {
        // Breakpoints are sorted, so everything after this is further away.
        break;
      }
    }

    if (chosen === -1) break;

    ranges.push({ start, end: chosen });
    start = chosen;
    nextBreakpoint = chosenIndex + 1;
  }

  ranges.push({ start, end: text.length });
  return ranges;
}

/** Trims surrounding whitespace by moving the range boundaries, not the string. */
function trimRanges(text: string, ranges: Range[]): Range[] {
  const trimmed: Range[] = [];

  for (const range of ranges) {
    let { start, end } = range;
    while (start < end && isWhitespace(text[start])) start++;
    while (end > start && isWhitespace(text[end - 1])) end--;
    if (end > start) trimmed.push({ start, end });
  }

  return trimmed;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value));
  if (!isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function readVariableId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length < 200 ? value : null;
}

function readSettings(msg: any): Settings {
  const widthType: WidthType =
    msg && (msg.widthType === 'container' || msg.widthType === 'fill') ? msg.widthType : 'column';
  const priority: Priority = msg && msg.priority === 'evenness' ? 'evenness' : 'paragraphs';

  return {
    columnCount: clampInt(msg && msg.columnCount, DEFAULTS.columnCount, LIMITS.columnCount.min, LIMITS.columnCount.max),
    width: clampInt(msg && msg.width, DEFAULTS.width, LIMITS.width.min, LIMITS.width.max),
    columnGutter: clampInt(msg && msg.columnGutter, DEFAULTS.columnGutter, LIMITS.columnGutter.min, LIMITS.columnGutter.max),
    widthType,
    priority,
    removeLinebreaks: msg ? msg.removeLinebreaks !== false : DEFAULTS.removeLinebreaks,
    widthVariableId: readVariableId(msg && msg.widthVariableId),
    gutterVariableId: readVariableId(msg && msg.gutterVariableId),
  };
}

/** Every selected text layer, in selection order. */
function selectedTextNodes(): TextNode[] {
  return figma.currentPage.selection.filter((node): node is TextNode => node.type === 'TEXT');
}

function firstSelectedText(): TextNode | null {
  return selectedTextNodes()[0] || null;
}

/** True when the node sits inside a component instance, where children are read-only. */
function isInsideInstance(node: BaseNode | null): boolean {
  let current = node;
  while (current) {
    if (current.type === 'INSTANCE') return true;
    current = current.parent;
  }
  return false;
}

interface FontContext {
  loaded: Set<string>;
  fallback: FontName;
}

async function loadFonts(fonts: FontName[]): Promise<Set<string>> {
  const unique = new Map<string, FontName>();
  for (const font of fonts) unique.set(fontKey(font), font);

  const loaded = new Set<string>();
  await Promise.all(
    Array.from(unique.keys()).map(async (key) => {
      try {
        await figma.loadFontAsync(unique.get(key) as FontName);
        loaded.add(key);
      } catch (error) {
        // Missing or unavailable font — the fallback font is used for these ranges.
      }
    })
  );

  return loaded;
}

/* -------------------------------------------------------------------------- */
/* Reading a source                                                           */
/* -------------------------------------------------------------------------- */

function readNodeStyle(node: TextNode): NodeStyle {
  return {
    textAlignHorizontal: node.textAlignHorizontal,
    paragraphIndent: node.paragraphIndent === figma.mixed ? null : node.paragraphIndent,
    paragraphSpacing: node.paragraphSpacing === figma.mixed ? null : node.paragraphSpacing,
    listSpacing: node.listSpacing === figma.mixed ? null : node.listSpacing,
    hangingPunctuation: node.hangingPunctuation,
    hangingList: node.hangingList,
    opacity: node.opacity,
    blendMode: node.blendMode,
    effects: node.effects,
    effectStyleId: node.effectStyleId,
    strokes: node.strokes,
    strokeAlign: node.strokeAlign,
    strokeWeight: node.strokeWeight === figma.mixed ? null : node.strokeWeight,
    leadingTrim: node.leadingTrim === figma.mixed ? null : node.leadingTrim,
  };
}

function readTextNode(node: TextNode): SourceContent {
  return {
    name: node.name,
    characters: node.characters,
    segments: node.getStyledTextSegments(SEGMENT_FIELDS),
    style: readNodeStyle(node),
  };
}

interface ColumnFrameData {
  version: number;
  settings: Settings;
  /** The whitespace that was trimmed away between each pair of columns. */
  separators: string[];
}

function readFrameData(node: BaseNode): ColumnFrameData | null {
  if (node.type !== 'FRAME') return null;

  const raw = node.getPluginData(PLUGIN_DATA_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== PLUGIN_DATA_VERSION) return null;
    return {
      version: parsed.version,
      settings: readSettings(parsed.settings),
      separators: Array.isArray(parsed.separators) ? parsed.separators : [],
    };
  } catch (error) {
    return null;
  }
}

/** Every selected frame this plugin generated, whose columns can be re-flowed. */
function selectedColumnFrames(): FrameNode[] {
  return figma.currentPage.selection.filter(
    (node): node is FrameNode => node.type === 'FRAME' && !!readFrameData(node)
  );
}

/**
 * The text layers this plugin put in the frame, in column order. Text the user
 * added themselves is left out, so a caption dropped into the frame is neither
 * folded into the columns nor removed when they are rebuilt.
 */
function columnChildren(frame: FrameNode): TextNode[] {
  const texts = frame.children.filter((child): child is TextNode => child.type === 'TEXT');
  const marked = texts.filter((child) => child.getPluginData(PLUGIN_DATA_KEY) === COLUMN_MARKER);
  return marked.length ? marked : texts;
}

/**
 * Rebuilds the original text from a generated frame. Reading the columns rather
 * than the layer they came from means edits made since are picked up, and the
 * original can have been moved or deleted.
 */
function readColumnFrame(frame: FrameNode, data: ColumnFrameData): SourceContent | null {
  const columns = columnChildren(frame);
  if (!columns.length) return null;

  let characters = '';
  const segments: Segment[] = [];

  for (let i = 0; i < columns.length; i++) {
    if (i > 0) {
      // Put back the whitespace that was trimmed away when the column was cut.
      const separator = typeof data.separators[i - 1] === 'string' ? data.separators[i - 1] : '\n';
      characters += separator;

      // Carry the previous column's styling across the join. Without this the
      // separator is unstyled, and a re-split that lands mid-column would leave a
      // stray character in the fallback font.
      if (segments.length) segments[segments.length - 1].end = characters.length;
    }

    const offset = characters.length;
    for (const segment of columns[i].getStyledTextSegments(SEGMENT_FIELDS)) {
      const shifted: Segment = Object.assign({}, segment, {
        start: segment.start + offset,
        end: segment.end + offset,
      });
      segments.push(shifted);
    }

    characters += columns[i].characters;
  }

  return {
    name: frame.name,
    characters,
    segments,
    style: readNodeStyle(columns[0]),
  };
}

/* -------------------------------------------------------------------------- */
/* Building the columns                                                       */
/* -------------------------------------------------------------------------- */

function applyNodeStyle(style: NodeStyle, target: TextNode): void {
  target.textAlignHorizontal = style.textAlignHorizontal;
  if (style.paragraphIndent !== null) target.paragraphIndent = style.paragraphIndent;
  if (style.paragraphSpacing !== null) target.paragraphSpacing = style.paragraphSpacing;
  if (style.listSpacing !== null) target.listSpacing = style.listSpacing;
  target.hangingPunctuation = style.hangingPunctuation;
  target.hangingList = style.hangingList;
  target.opacity = style.opacity;
  target.blendMode = style.blendMode;
  target.effects = style.effects;
  target.strokes = style.strokes;
  target.strokeAlign = style.strokeAlign;

  if (style.leadingTrim !== null) target.leadingTrim = style.leadingTrim;
  if (style.strokeWeight !== null) target.strokeWeight = style.strokeWeight;
}

/**
 * Copies one source segment onto `[from, to)` of a new text node. Returns a promise
 * because styles are applied through the async API required by dynamic page access.
 */
async function applySegment(
  target: TextNode,
  segment: Segment,
  from: number,
  to: number,
  fonts: FontContext
): Promise<void> {
  let styleApplied = false;

  if (segment.textStyleId) {
    try {
      await target.setRangeTextStyleIdAsync(from, to, segment.textStyleId);
      styleApplied = true;
    } catch (error) {
      // Style not available in this document — fall back to raw properties.
    }
  }

  if (!styleApplied) {
    const font = fonts.loaded.has(fontKey(segment.fontName)) ? segment.fontName : fonts.fallback;
    target.setRangeFontName(from, to, font);
    target.setRangeFontSize(from, to, segment.fontSize);
    target.setRangeTextCase(from, to, segment.textCase);
    target.setRangeTextDecoration(from, to, segment.textDecoration);
    target.setRangeLineHeight(from, to, segment.lineHeight);
    target.setRangeLetterSpacing(from, to, segment.letterSpacing);
  }

  let fillStyleApplied = false;
  if (segment.fillStyleId) {
    try {
      await target.setRangeFillStyleIdAsync(from, to, segment.fillStyleId);
      fillStyleApplied = true;
    } catch (error) {
      // Fall through to the raw paints.
    }
  }
  if (!fillStyleApplied && segment.fills) {
    target.setRangeFills(from, to, segment.fills);
  }

  if (segment.indentation) target.setRangeIndentation(from, to, segment.indentation);
  if (segment.listOptions && segment.listOptions.type !== 'NONE') {
    target.setRangeListOptions(from, to, segment.listOptions);
  }
  // Links are per range, so they have to be re-applied to survive the split.
  if (segment.hyperlink) target.setRangeHyperlink(from, to, segment.hyperlink);
}

interface BuildContext {
  content: SourceContent;
  normalised: NormalisedText;
  segmentAt: Int32Array;
  fonts: FontContext;
}

/**
 * Re-applies the source styling to `target`, for the slice of normalised text
 * `[textStart, textEnd)` written at `nodeOffset` in the node.
 *
 * Characters that share a segment are handled in one pass, so the number of API
 * calls tracks the number of distinct styles rather than the length of the text.
 */
async function applyStyleRuns(
  target: TextNode,
  nodeOffset: number,
  textStart: number,
  textEnd: number,
  context: BuildContext
): Promise<void> {
  const { normalised, segments, segmentAt, fonts } = {
    normalised: context.normalised,
    segments: context.content.segments,
    segmentAt: context.segmentAt,
    fonts: context.fonts,
  };

  const length = textEnd - textStart;
  if (length <= 0) return;

  const pending: Promise<void>[] = [];
  let runStart = 0;
  let runSegment = segmentAt[normalised.source[textStart]];

  for (let i = 1; i <= length; i++) {
    const segment = i < length ? segmentAt[normalised.source[textStart + i]] : -2;
    if (segment === runSegment) continue;

    if (runSegment >= 0) {
      // Disjoint ranges, so these can all be in flight at once.
      pending.push(
        applySegment(target, segments[runSegment], nodeOffset + runStart, nodeOffset + i, fonts)
      );
    }

    runStart = i;
    runSegment = segment;
  }

  await Promise.all(pending);
}

async function createColumn(range: Range, context: BuildContext): Promise<TextNode> {
  const textbox = figma.createText();
  textbox.setPluginData(PLUGIN_DATA_KEY, COLUMN_MARKER);
  // The font has to be set before `characters`, otherwise Figma writes with the
  // (possibly unloaded) default font.
  textbox.fontName = context.fonts.fallback;
  textbox.characters = context.normalised.text.slice(range.start, range.end);

  applyNodeStyle(context.content.style, textbox);
  await applyStyleRuns(textbox, 0, range.start, range.end, context);

  return textbox;
}

/* -------------------------------------------------------------------------- */
/* Variables                                                                  */
/* -------------------------------------------------------------------------- */

/** A number variable the window can offer for the width or the gutter. */
interface VariableOption {
  id: string;
  name: string;
  collection: string;
  /** The value in the collection's default mode, aliases followed. */
  value: number;
}

const MAX_VARIABLE_OPTIONS = 500;
const MAX_ALIAS_DEPTH = 8;

type CollectionCache = Map<string, VariableCollection>;

async function collectionFor(id: string, cache: CollectionCache): Promise<VariableCollection | null> {
  const cached = cache.get(id);
  if (cached) return cached;

  const found = await figma.variables.getVariableCollectionByIdAsync(id);
  if (found) cache.set(id, found);
  return found;
}

/** The variable's value in its collection's default mode, following aliases. */
async function resolveNumber(
  variable: Variable,
  cache: CollectionCache,
  depth: number = 0
): Promise<number | null> {
  if (depth > MAX_ALIAS_DEPTH) return null;

  const collection = await collectionFor(variable.variableCollectionId, cache);
  if (!collection) return null;

  const value = variable.valuesByMode[collection.defaultModeId];
  if (typeof value === 'number') return isFinite(value) ? value : null;

  if (value && typeof value === 'object' && (value as VariableAlias).type === 'VARIABLE_ALIAS') {
    const target = await figma.variables.getVariableByIdAsync((value as VariableAlias).id);
    return target ? resolveNumber(target, cache, depth + 1) : null;
  }

  return null;
}

/** The file's local number variables, for the window to offer. */
async function listNumberVariables(): Promise<VariableOption[]> {
  try {
    const [variables, collections] = await Promise.all([
      figma.variables.getLocalVariablesAsync('FLOAT'),
      figma.variables.getLocalVariableCollectionsAsync(),
    ]);

    const cache: CollectionCache = new Map();
    collections.forEach((collection) => cache.set(collection.id, collection));

    const options: VariableOption[] = [];
    for (const variable of variables) {
      if (options.length >= MAX_VARIABLE_OPTIONS) break;

      const value = await resolveNumber(variable, cache);
      if (value === null) continue;

      const collection = cache.get(variable.variableCollectionId);
      options.push({
        id: variable.id,
        name: variable.name,
        collection: collection ? collection.name : '',
        value: Math.round(value * 100) / 100,
      });
    }

    options.sort((a, b) => a.collection.localeCompare(b.collection) || a.name.localeCompare(b.name));
    return options;
  } catch (error) {
    // Listing is a convenience — the fields still work with typed numbers.
    return [];
  }
}

async function lookupNumberVariable(
  id: string | null,
  cache: CollectionCache
): Promise<{ variable: Variable; value: number } | null> {
  if (!id) return null;

  try {
    const variable = await figma.variables.getVariableByIdAsync(id);
    if (!variable || variable.resolvedType !== 'FLOAT') return null;

    const value = await resolveNumber(variable, cache);
    return value === null ? null : { variable, value };
  } catch (error) {
    return null;
  }
}

interface ResolvedBindings {
  /** Settings to build with: bound numbers replaced by the variable's value. */
  settings: Settings;
  widthVariable: Variable | null;
  gutterVariable: Variable | null;
  /** Which of the two could not be found, so the user can be told. */
  missing: string[];
}

/**
 * Looks the bound variables up again at build time. The window only knows what it
 * was last sent, and a variable may have been renamed, changed or deleted since.
 */
async function resolveBindings(requested: Settings): Promise<ResolvedBindings> {
  const settings = Object.assign({}, requested);
  const cache: CollectionCache = new Map();
  const missing: string[] = [];
  let widthVariable: Variable | null = null;
  let gutterVariable: Variable | null = null;

  // Fill parent takes its width from the parent, so a width variable is not used.
  if (requested.widthType !== 'fill') {
    const found = await lookupNumberVariable(requested.widthVariableId, cache);
    if (found) {
      widthVariable = found.variable;
      settings.width = clampInt(found.value, requested.width, LIMITS.width.min, LIMITS.width.max);
    } else if (requested.widthVariableId) {
      missing.push('width');
      settings.widthVariableId = null;
    }
  }

  const gutter = await lookupNumberVariable(requested.gutterVariableId, cache);
  if (gutter) {
    gutterVariable = gutter.variable;
    settings.columnGutter = clampInt(
      gutter.value,
      requested.columnGutter,
      LIMITS.columnGutter.min,
      LIMITS.columnGutter.max
    );
  } else if (requested.gutterVariableId) {
    missing.push('gutter');
    settings.gutterVariableId = null;
  }

  return { settings, widthVariable, gutterVariable, missing };
}

/* -------------------------------------------------------------------------- */
/* Placement                                                                  */
/* -------------------------------------------------------------------------- */

type PlacementContainer = FrameNode | ComponentNode | SectionNode | SlideNode;

/**
 * The nearest ancestor the columns can be dropped into: a container that is not
 * running auto layout, so they sit beside the text instead of being pulled into a
 * layout. Slides count as containers, which is what keeps the columns on the slide
 * in Figma Slides and Figma Buzz, where the page itself holds a grid rather than
 * loose artwork.
 */
function placementContainer(source: SceneNode): PlacementContainer | null {
  let node: BaseNode | null = source.parent;

  while (node) {
    // Children of an instance are read only, so nothing can be added there.
    if (node.type === 'INSTANCE') return null;
    if (node.type === 'PAGE' || node.type === 'DOCUMENT') return null;

    const isContainer =
      node.type === 'FRAME' ||
      node.type === 'COMPONENT' ||
      node.type === 'SECTION' ||
      node.type === 'SLIDE';
    const isAutoLayout = 'layoutMode' in node && node.layoutMode !== 'NONE';

    if (isContainer && !isAutoLayout) return node as PlacementContainer;
    node = node.parent;
  }

  return null;
}

type AutoLayoutParent = FrameNode | ComponentNode | SlideNode;

/** The auto layout frame directly holding the node, when columns can join it. */
function autoLayoutParent(node: SceneNode): AutoLayoutParent | null {
  const parent = node.parent;
  if (!parent) return null;
  if (parent.type !== 'FRAME' && parent.type !== 'COMPONENT' && parent.type !== 'SLIDE') return null;
  if (parent.layoutMode === 'NONE' || isInsideInstance(parent)) return null;
  return parent;
}

/** How much room "fill parent" has for a node: the parent's width less its padding. */
function fillWidthFor(node: SceneNode): number {
  const flow = autoLayoutParent(node);
  if (flow) return flow.width - flow.paddingLeft - flow.paddingRight;

  const container = placementContainer(node);
  return container ? container.width : node.width;
}

function placeColumns(frame: FrameNode, source: SceneNode, gap: number, fill: boolean): void {
  if (fill) {
    const flow = autoLayoutParent(source);
    if (flow) {
      // Straight after the text in the same layout, so the columns flow with
      // everything around them. Sized to fill by applyFillSizing.
      flow.insertChild(flow.children.indexOf(source) + 1, frame);
      return;
    }
  }

  const container = placementContainer(source);

  if (container) {
    container.appendChild(frame);
  } else if (frame.parent !== figma.currentPage) {
    figma.currentPage.appendChild(frame);
  }

  // Coordinates are relative to whatever the frame ended up inside.
  const sourceBox = source.absoluteBoundingBox;
  const containerBox = container ? container.absoluteBoundingBox : null;
  const offsetX = containerBox ? containerBox.x : 0;
  const offsetY = containerBox ? containerBox.y : 0;

  if (fill) {
    // As wide as the parent, so it goes under the text rather than beside it.
    frame.x = container ? 0 : sourceBox ? sourceBox.x : source.x;
    frame.y = (sourceBox ? sourceBox.y + sourceBox.height : source.y + source.height) + gap - offsetY;
    return;
  }

  if (sourceBox) {
    frame.x = sourceBox.x + sourceBox.width + gap - offsetX;
    frame.y = sourceBox.y - offsetY;
  } else {
    frame.x = source.x + source.width + gap;
    frame.y = source.y;
  }
}

/**
 * Sizes the frame to its parent once it is in place. Returns false when there is
 * no parent to fill, in which case it takes `fallbackWidth` instead.
 */
function applyFillSizing(frame: FrameNode, fallbackWidth: number): boolean {
  const parent = frame.parent;

  const inFlow =
    !!parent &&
    (parent.type === 'FRAME' || parent.type === 'COMPONENT' || parent.type === 'SLIDE') &&
    parent.layoutMode !== 'NONE';
  if (inFlow) {
    frame.layoutSizingHorizontal = 'FILL';
    return true;
  }

  const isContainer =
    !!parent &&
    (parent.type === 'FRAME' ||
      parent.type === 'COMPONENT' ||
      parent.type === 'SECTION' ||
      parent.type === 'SLIDE');
  frame.primaryAxisSizingMode = 'FIXED';
  frame.resize(isContainer ? (parent as PlacementContainer).width : fallbackWidth, frame.height);
  return isContainer;
}

/** A frame that used to fill its parent has to give that up when the mode changes. */
function releaseFillSizing(frame: FrameNode, widthType: WidthType): void {
  const parent = frame.parent;
  const inFlow =
    !!parent &&
    (parent.type === 'FRAME' || parent.type === 'COMPONENT' || parent.type === 'SLIDE') &&
    parent.layoutMode !== 'NONE';
  if (!inFlow) return;

  try {
    frame.layoutSizingHorizontal = widthType === 'container' ? 'FIXED' : 'HUG';
  } catch (error) {
    // Not a layout child after all — nothing to release.
  }
}

/* -------------------------------------------------------------------------- */
/* Main action                                                                */
/* -------------------------------------------------------------------------- */

interface BuildRequest {
  content: SourceContent;
  settings: Settings;
  /** Existing frame to rebuild in place, or the node to place a new frame beside. */
  target: { mode: 'reflow'; frame: FrameNode } | { mode: 'create'; beside: SceneNode };
}

interface BuildResult {
  frame: FrameNode;
  columnCount: number;
  fellBackToWords: boolean;
  /** Things worth telling the user that did not stop the columns being made. */
  notes: string[];
}

type BuildOutcome = { ok: true; result: BuildResult } | { ok: false; error: string };

const fail = (error: string): BuildOutcome => ({ ok: false, error });

async function buildColumns(request: BuildRequest): Promise<BuildOutcome> {
  const { content } = request;
  const target = request.target;

  const bindings = await resolveBindings(request.settings);
  const settings = bindings.settings;
  const notes: string[] = [];

  if (bindings.missing.length) {
    notes.push(
      `The ${bindings.missing.join(' and ')} variable could not be found, so its last value was used.`
    );
  }

  const anchor: SceneNode = target.mode === 'create' ? target.beside : target.frame;
  // Read before anything is rebuilt, since a re-flow resizes the frame as it goes.
  const anchorWidth = anchor.width;
  const fill = settings.widthType === 'fill';

  const gutter = settings.columnGutter;
  const totalGutters = gutter * (settings.columnCount - 1);

  if (settings.widthType === 'container' && settings.width - totalGutters < settings.columnCount) {
    return fail('Container width is too small for that many columns and gutters');
  }
  if (fill && fillWidthFor(anchor) - totalGutters < settings.columnCount) {
    return fail('The parent is too narrow for that many columns and gutters');
  }

  const normalised = normalise(content.characters, settings.removeLinebreaks);
  if (!normalised.text.trim()) return fail('There is no text to split');

  // Map every character of the original onto the segment that styles it.
  const segmentAt = new Int32Array(content.characters.length);
  segmentAt.fill(-1);
  for (let s = 0; s < content.segments.length; s++) {
    const segment = content.segments[s];
    for (let i = segment.start; i < segment.end && i < segmentAt.length; i++) segmentAt[i] = s;
  }

  // Work out where the columns can break.
  const wantsParagraphs = settings.priority === 'paragraphs';
  let breakpoints = findBreakpoints(normalised.text, wantsParagraphs);
  let fellBackToWords = false;

  if (wantsParagraphs && breakpoints.length < settings.columnCount - 1) {
    breakpoints = findBreakpoints(normalised.text, false);
    fellBackToWords = true;
  }

  // Preload every font used in the source so the columns can be built in order.
  const loaded = await loadFonts(
    content.segments.map((segment) => segment.fontName).concat(FALLBACK_FONTS)
  );

  // Prefer a font the source actually uses so any unstyled run still looks right.
  const fallbackFont = content.segments
    .map((segment) => segment.fontName)
    .concat(FALLBACK_FONTS)
    .filter((font) => loaded.has(fontKey(font)))[0];

  if (!fallbackFont) return fail('Could not load a font to build the columns with');

  const context: BuildContext = {
    content,
    normalised,
    segmentAt,
    fonts: { loaded, fallback: fallbackFont },
  };

  const ranges = trimRanges(
    normalised.text,
    splitIntoRanges(normalised.text, settings.columnCount, breakpoints)
  );
  if (!ranges.length) return fail('There is not enough text to create columns');

  const frame = target.mode === 'reflow' ? target.frame : figma.createFrame();
  // Only the columns are replaced — anything else the user put in the frame stays.
  const previousChildren: SceneNode[] = target.mode === 'reflow' ? columnChildren(frame) : [];
  const columns: TextNode[] = [];

  try {
    // Appearance is only set up once, so re-flowing keeps any styling applied to
    // the frame since. Layout and spacing follow the settings every time.
    if (target.mode === 'create') {
      frame.name = `${content.name} — columns`;
      frame.clipsContent = false;
      frame.fills = [];
      frame.counterAxisAlignItems = 'MIN';
    } else if (!fill) {
      releaseFillSizing(frame, settings.widthType);
    }

    frame.layoutMode = 'HORIZONTAL';
    frame.itemSpacing = gutter;
    frame.primaryAxisSizingMode = 'AUTO';
    frame.counterAxisSizingMode = 'AUTO';

    for (const range of ranges) columns.push(await createColumn(range, context));

    if (settings.widthType === 'container') {
      frame.primaryAxisSizingMode = 'FIXED';
      frame.resize(settings.width, frame.height);
    }

    for (const column of columns) {
      column.textAutoResize = 'HEIGHT';
      frame.appendChild(column);

      if (settings.widthType === 'column') {
        column.resize(settings.width, column.height);
        column.layoutSizingHorizontal = 'FIXED';
      } else {
        column.layoutSizingHorizontal = 'FILL';
      }
      column.layoutSizingVertical = 'HUG';
    }

    // The old columns only go once the new ones are safely in place.
    for (const child of previousChildren) child.remove();

    // Remember how this was built so it can be re-flowed later.
    const separators: string[] = [];
    for (let i = 1; i < ranges.length; i++) {
      separators.push(normalised.text.slice(ranges[i - 1].end, ranges[i].start));
    }
    const data: ColumnFrameData = { version: PLUGIN_DATA_VERSION, settings, separators };
    frame.setPluginData(PLUGIN_DATA_KEY, JSON.stringify(data));
    frame.setRelaunchData({ reflow: 'Re-balance these columns' });

    if (target.mode === 'create') placeColumns(frame, target.beside, 50, fill);

    if (fill && !applyFillSizing(frame, anchorWidth)) {
      notes.push('There is no parent frame to fill, so the columns match the width of the text layer.');
    }

    if (content.style.effectStyleId) {
      await Promise.all(
        columns.map((column) => column.setEffectStyleIdAsync(content.style.effectStyleId).catch(() => {}))
      );
    }

    // Bound last, once the sizes are settled — binding takes the variable's value.
    const unbound: string[] = [];
    const bind = (
      node: FrameNode | TextNode,
      field: 'width' | 'itemSpacing',
      variable: Variable | null,
      label: string
    ) => {
      try {
        node.setBoundVariable(field, variable);
      } catch (error) {
        if (variable && unbound.indexOf(label) === -1) unbound.push(label);
      }
    };

    // A re-flow also clears a binding left over from the last time.
    if (bindings.gutterVariable || target.mode === 'reflow') {
      bind(frame, 'itemSpacing', bindings.gutterVariable, 'gutter');
    }

    const frameWidthVariable = settings.widthType === 'container' ? bindings.widthVariable : null;
    if (frameWidthVariable || target.mode === 'reflow') {
      bind(frame, 'width', frameWidthVariable, 'width');
    }
    if (settings.widthType === 'column' && bindings.widthVariable) {
      for (const column of columns) bind(column, 'width', bindings.widthVariable, 'width');
    }

    if (unbound.length) {
      notes.push(`Could not bind the ${unbound.join(' and ')} variable, so its value was used instead.`);
    }
  } catch (error) {
    // A new frame is scrapped on failure; an existing one keeps its old columns.
    for (const column of columns) {
      if (!column.removed) column.remove();
    }
    if (target.mode === 'create') frame.remove();
    throw error;
  }

  return { ok: true, result: { frame, columnCount: ranges.length, fellBackToWords, notes } };
}

function reportResult(result: BuildResult, settings: Settings): void {
  if (result.columnCount < settings.columnCount) {
    figma.notify(
      `Only ${result.columnCount} column${result.columnCount === 1 ? '' : 's'} could be filled with this text`,
      { timeout: 4000 }
    );
  } else if (result.fellBackToWords) {
    figma.notify('Not enough paragraphs for that many columns — split on words instead', { timeout: 4000 });
  }
}

interface BatchJob {
  settings: Settings;
  run: () => Promise<BuildOutcome>;
}

interface BatchLabels {
  one: string;
  many: string;
}

const addUnique = (list: string[], item: string) => {
  if (list.indexOf(item) === -1) list.push(item);
};

/**
 * Runs one job per selected layer, one after another. A layer that cannot be split
 * is skipped and reported rather than stopping the rest.
 */
async function runBatch(jobs: BatchJob[], labels: BatchLabels, zoomToResult: boolean): Promise<boolean> {
  const frames: FrameNode[] = [];
  const problems: string[] = [];
  const notes: string[] = [];
  let tooShort = 0;
  let wordFallbacks = 0;
  let lastResult: BuildResult | null = null;
  let progress: NotificationHandler | null = null;

  for (let i = 0; i < jobs.length; i++) {
    if (jobs.length > 2) {
      if (progress) progress.cancel();
      progress = figma.notify(`Splitting ${i + 1} of ${jobs.length}…`, { timeout: Infinity });
    }

    let outcome: BuildOutcome;
    try {
      outcome = await jobs[i].run();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      outcome = fail(`Could not create columns: ${detail}`);
    }

    if (!outcome.ok) {
      addUnique(problems, outcome.error);
      continue;
    }

    const result = outcome.result;
    lastResult = result;
    frames.push(result.frame);
    result.notes.forEach((note) => addUnique(notes, note));
    if (result.columnCount < jobs[i].settings.columnCount) tooShort++;
    else if (result.fellBackToWords) wordFallbacks++;
  }

  if (progress) progress.cancel();

  if (!frames.length) {
    figma.notify(
      jobs.length === 1
        ? problems[0]
        : `None of the ${jobs.length} ${labels.many} could be split — ${problems.join('; ')}`,
      { error: true, timeout: 5000 }
    );
    return false;
  }

  figma.currentPage.selection = frames;
  if (zoomToResult) figma.viewport.scrollAndZoomIntoView(frames);
  figma.commitUndo();

  if (jobs.length === 1 && lastResult) {
    reportResult(lastResult, jobs[0].settings);
  } else {
    if (problems.length) {
      figma.notify(`Split ${frames.length} of ${jobs.length} ${labels.many} — ${problems.join('; ')}`, {
        timeout: 5000,
      });
    }
    if (tooShort) {
      figma.notify(
        `${tooShort} of ${frames.length} had too little text to fill all the columns`,
        { timeout: 4000 }
      );
    }
    if (wordFallbacks) {
      figma.notify(
        `${wordFallbacks} of ${frames.length} had too few paragraphs, so they were split on words`,
        { timeout: 4000 }
      );
    }
  }

  notes.forEach((note) => figma.notify(note, { timeout: 5000 }));
  return true;
}

/** Creates a set of columns beside every selected text layer. */
async function createFromSelection(settings: Settings): Promise<boolean> {
  const sources = selectedTextNodes();
  if (!sources.length) {
    figma.notify('Select a text layer to continue', { error: true, timeout: 3000 });
    return false;
  }

  const jobs: BatchJob[] = sources.map((source) => ({
    settings,
    run: async (): Promise<BuildOutcome> => {
      if (source.hasMissingFont) {
        return fail('This text layer uses a font that is not available — install it and try again');
      }
      return buildColumns({
        content: readTextNode(source),
        settings,
        target: { mode: 'create', beside: source },
      });
    },
  }));

  return runBatch(jobs, { one: 'text layer', many: 'text layers' }, true);
}

/** Rebuilds every selected set of columns, picking up any edits made to them. */
async function reflowSelection(settings: Settings | null): Promise<boolean> {
  const frames = selectedColumnFrames();
  if (!frames.length) {
    figma.notify('Select a set of columns made by this plugin', { error: true, timeout: 3000 });
    return false;
  }

  const jobs: BatchJob[] = frames.map((frame) => {
    const data = readFrameData(frame) as ColumnFrameData;
    const used = settings || data.settings;

    return {
      settings: used,
      run: async (): Promise<BuildOutcome> => {
        const content = readColumnFrame(frame, data);
        if (!content) return fail('These columns no longer contain any text');
        return buildColumns({ content, settings: used, target: { mode: 'reflow', frame } });
      },
    };
  });

  return runBatch(jobs, { one: 'set of columns', many: 'sets of columns' }, false);
}

/* -------------------------------------------------------------------------- */
/* Plugin lifecycle                                                           */
/* -------------------------------------------------------------------------- */

function postSelection(): void {
  const frames = selectedColumnFrames();
  const texts = selectedTextNodes();
  const first: SceneNode | null = frames[0] || texts[0] || null;
  const data = frames[0] ? readFrameData(frames[0]) : null;

  figma.ui.postMessage({
    type: 'selection',
    mode: frames.length ? 'reflow' : texts.length ? 'create' : 'none',
    // How many layers (or sets of columns) the button will act on.
    count: frames.length || texts.length,
    name: first ? first.name : null,
    // Identifies the selection so the window only re-fills the fields when it changes.
    id: first ? first.id : null,
    // Selecting existing columns shows the settings they were built with.
    settings: data ? data.settings : null,
    // Lets the window offer the layer's own width as a starting point.
    width: texts[0] ? Math.round(texts[0].width) : null,
  });
}

async function postVariables(): Promise<void> {
  figma.ui.postMessage({ type: 'variables', variables: await listNumberVariables() });
}

function showWindow(): void {
  figma.showUI(__html__, { width: UI_WIDTH, height: UI_INITIAL_HEIGHT, themeColors: true });

  figma.clientStorage
    .getAsync(SETTINGS_KEY)
    .catch(() => null)
    .then((stored) => {
      figma.ui.postMessage({
        type: 'init',
        settings: stored ? readSettings(stored) : DEFAULTS,
        hasStoredSettings: !!stored,
        limits: LIMITS,
      });
      postSelection();
      postVariables();
    });

  figma.on('selectionchange', postSelection);

  figma.ui.onmessage = async (msg) => {
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'resize') {
      figma.ui.resize(UI_WIDTH, clampInt(msg.height, UI_INITIAL_HEIGHT, UI_MIN_HEIGHT, UI_MAX_HEIGHT));
      return;
    }

    if (msg.type === 'request-variables') {
      await postVariables();
      return;
    }

    if (msg.type !== 'create-columns') return;

    const settings = readSettings(msg);

    try {
      const done = msg.mode === 'reflow' ? await reflowSelection(settings) : await createFromSelection(settings);
      if (done) await figma.clientStorage.setAsync(SETTINGS_KEY, settings);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      figma.notify(`Could not create columns: ${detail}`, { error: true, timeout: 5000 });
    } finally {
      figma.ui.postMessage({ type: 'done' });
      postSelection();
    }
  };
}

/** Suggestions for the quick action parameter fields. */
figma.parameters.on('input', ({ key, query, result }) => {
  const options = key === 'columns' ? ['2', '3', '4', '5', '6'] : ['20', '40', '50', '100', '350', '600'];
  const typed = query.trim();

  const suggestions = options.filter((option) => option.indexOf(typed) === 0);
  if (typed && /^\d+$/.test(typed) && suggestions.indexOf(typed) === -1) suggestions.unshift(typed);

  result.setSuggestions(suggestions.length ? suggestions : options);
});

figma.on('run', async ({ command, parameters }) => {
  // Re-balance button in the right hand panel of a generated frame.
  if (command === 'reflow') {
    try {
      await reflowSelection(null);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      figma.notify(`Could not re-balance the columns: ${detail}`, { error: true, timeout: 5000 });
    }
    figma.closePlugin();
    return;
  }

  // Run straight from the quick actions bar, without opening the window.
  if (parameters) {
    const stored = await figma.clientStorage.getAsync(SETTINGS_KEY).catch(() => null);
    const base = stored ? readSettings(stored) : DEFAULTS;
    // Typing a width or gutter here replaces any variable the last run was bound to.
    const hasWidth = typeof parameters.width === 'string' && parameters.width.trim() !== '';
    const hasGutter = typeof parameters.gutter === 'string' && parameters.gutter.trim() !== '';

    const settings: Settings = {
      columnCount: clampInt(parameters.columns, base.columnCount, LIMITS.columnCount.min, LIMITS.columnCount.max),
      width: clampInt(parameters.width, base.width, LIMITS.width.min, LIMITS.width.max),
      columnGutter: clampInt(parameters.gutter, base.columnGutter, LIMITS.columnGutter.min, LIMITS.columnGutter.max),
      widthType: base.widthType,
      priority: base.priority,
      removeLinebreaks: base.removeLinebreaks,
      widthVariableId: hasWidth ? null : base.widthVariableId,
      gutterVariableId: hasGutter ? null : base.gutterVariableId,
    };

    try {
      // Whichever is selected: re-balance existing columns, or make new ones.
      const done = selectedColumnFrames().length ? await reflowSelection(settings) : await createFromSelection(settings);
      if (done) await figma.clientStorage.setAsync(SETTINGS_KEY, settings);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      figma.notify(`Could not create columns: ${detail}`, { error: true, timeout: 5000 });
    }
    figma.closePlugin();
    return;
  }

  showWindow();
});
