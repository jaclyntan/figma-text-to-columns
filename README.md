# Text to Columns
![figma text to columns](plugin-promotional-banner.jpg)
## Generate evenly balanced columns from long form text.

### ✨ To Use
- Select an element containing text
- Run the plugin
- Update settings if required
- Click 'Create columns'

**Without opening the window** — in the quick actions bar (`⌘/` or `Ctrl /`) type
`Text to Columns`, then a column count, and optionally a width and a gutter. Run it
with no parameters and the window opens as usual.

### ✨ Changed your mind?
Select the columns the plugin made and it switches to **Update columns**, pre-filled
with the settings they were built with. Change the count, width or gutter and the
same frame is rebuilt in place — nothing to delete.

The columns themselves are the source of truth, so any text you edited inside them is
kept, and the layer they came from can be moved or deleted. Re-flowing keeps the
frame's position, its name, and any styling you gave it, and anything else you put
inside the frame — a caption, a rule, a note — is left alone.

There is also a **Re-balance columns** button on the frame in the properties panel,
for re-flowing after an edit without opening the window at all.

### ✨ Where it runs
Figma Design, FigJam, Figma Slides and Figma Buzz. In Slides and Buzz the columns are
placed on the slide or asset the text sits on, rather than loose on the canvas.

It is not available in Dev Mode, which is read only — plugins there can inspect the
file but not add layers to it.

### ✨ Settings
- **Columns** — how many columns to split the text into (2–50)
- **Column width / Container width** — either the width of each individual column, or the total width the columns have to share (gutters included)
- **Gutter** — the space between columns
- **Prioritise Paragraphs** — columns only break between paragraphs, so a paragraph is never split in two
- **Prioritise Even Split** — columns break between words, so every column holds a similar amount of text
- **Remove multiple line breaks** — collapses runs of blank lines down to a single break

Your settings are remembered between runs. On a first run the width starts from the
width of the layer you have selected.

### ✨ Notes
- Works on any text layer. If several are selected, the first one is used
- Words are never split across columns
- Columns are balanced by how much text they hold, so the end result may still need some manual finessing depending on your design
- Type styling is copied from the original text — mixed fonts, sizes, colours, text styles, fill styles, links, lists and indentation are all preserved per character
- The new columns are placed in an auto layout frame beside the original text, so you can adjust the gutter and widths afterwards without re-running the plugin
- Creating or re-flowing columns is a single undo step
- If there is not enough text (or not enough paragraphs) to fill the number of columns you asked for, the plugin creates as many as it can and tells you
- If the text uses a font that isn't installed, install it first — Figma can't rewrite text in a missing font

### 🔒 Data and privacy
The plugin runs entirely offline. It makes no network requests, and the manifest
declares `networkAccess: none`. Nothing is sent anywhere, and there is no analytics,
tracking or account of any kind. The only external link is the "Buy me a coffee"
link in the footer, which opens in your browser if you click it.

It does store two things, both through Figma's own plugin API:

**In the document, on the generated frame** (`setPluginData`) — the settings the
columns were built with (column count, width, width mode, gutter, priority, and the
line-break option), plus the whitespace that was trimmed from between each pair of
columns. That whitespace is what lets a re-flow stitch the columns back together
exactly. It is only ever spaces, tabs and line breaks — none of the words in your
text are stored. Each generated column also carries a one-word marker
(`"column"`) so a re-flow knows which layers are its own. Removing the frame
removes all of it.

**On your machine** (`clientStorage`) — the same six settings, so the window opens
with what you used last time. `clientStorage` is local to your Figma client and is
not readable by other plugins.

No document content, file names, user names or identifiers are stored or
transmitted.

### ❌ If you encounter any errors ❌
The plugin reports what went wrong in a Figma notification. If you hit something that isn't covered by one of those messages, please [open an issue](https://github.com/jaclyntan/figma-text-to-columns/issues) with the text you were splitting — it helps a lot.

### 🛠 Development
```sh
npm install
npm run build     # compiles code.ts -> code.js
npm run watch     # rebuild on change
npm run typecheck # type check without emitting
npm test          # build, then run the splitting + column-building tests
```
The tests run the compiled `code.js` against a stubbed Figma API — no Figma, no
dependencies beyond Node. They cover the splitting maths, per character style and
link preservation, the re-flow round trip, and every failure path.

Then in Figma: **Plugins → Development → Import plugin from manifest** and pick `manifest.json`.

The plugin declares `documentAccess: "dynamic-page"` and uses Figma's async style
APIs, so it needs a reasonably current version of the editor.

---
♡ If you run into any bugs or have feature requests please submit an issue.
