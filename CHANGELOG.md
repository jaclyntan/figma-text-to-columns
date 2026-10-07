# Changelog

## 1.2.0

### Added
- **Re-flow existing columns.** Select a set of columns the plugin made and the
  window switches to "Update columns", pre-filled with the settings they were built
  with. Change the count, width or gutter and the same frame is rebuilt in place,
  keeping its position and name. Edits made inside the columns are picked up, so the
  columns themselves are the source of truth — the original layer can be long gone.
- **A "Re-balance columns" button** on the generated frame in the properties panel,
  for re-flowing after editing without opening the window at all.
- **Run from the quick actions bar** without opening the window: `Text to Columns`
  then a column count, and optionally a width and gutter. Running it with no
  parameters still opens the window as before.
- The width field starts from the width of the selected layer on first run.
- **Fill parent.** A third width option that makes the columns as wide as whatever
  they sit in. Inside an auto layout frame they join the layout straight after the
  text and fill it; inside a plain frame, section or slide they match its width and go
  below the text. Re-flowing follows the parent as it changes.
- **Variables in the width and gutter fields.** A variable button inside each field
  lists the file's number variables. Picking one shows its name in the field and binds
  the layout to it, so changing the variable changes the columns. Re-flow keeps the
  binding, and a variable that has been deleted falls back to its last value with a
  note instead of failing.
- **Several text layers at once.** Select as many as you like; each gets its own set
  of columns in a single undo step, and a layer that cannot be split is skipped and
  reported rather than stopping the rest. Re-flowing several sets works the same way.
- A refined variable picker: searchable, grouped by collection, with right-aligned
  values, keyboard navigation and a minimal scrollbar that only appears on hover.
- **Runs in Figma Slides and Figma Buzz** as well as Figma Design and FigJam. The
  columns are placed inside the slide or asset the text belongs to.

### Changed
- Now declares `documentAccess: "dynamic-page"` and uses the async style APIs
  (`setRangeTextStyleIdAsync`, `setRangeFillStyleIdAsync`, `setEffectStyleIdAsync`),
  which is what Figma expects of plugins going forward.
- Figma plugin typings updated from 1.79 to 1.133.
- The "Buy me a coffee" footer is gone from the window.
- Splitting is unchanged from 1.1.0: both Prioritise Paragraphs and Prioritise Even
  Split still balance columns by character count. A height-measuring pass and a rule
  that held headings back from the foot of a column were tried and dropped — they
  made real documents look less balanced, not more.

### Fixed
- Text whose paragraph spacing, paragraph indent or list spacing varied reported
  those as mixed and threw when copied. They are now left alone in that case.
- Re-flowing reset the frame's fill, its clipping and its alignment. Only layout and
  spacing follow the settings now; appearance is left as the user set it.
- Text inside an auto layout frame put its columns out on the canvas. The plugin now
  walks up to the nearest container that is not running auto layout, so the columns
  stay inside the card or section the text belongs to.
- The whitespace joining two columns carried no styling, so once a re-split moved it
  into the middle of a column it showed up in the fallback font.
- Text the user added inside the columns frame was folded into the columns and then
  deleted on the next re-flow. The plugin's own columns are marked, so anything else
  in the frame is left alone.
- The window re-sent its height on every keystroke, and overwrote a width you had
  typed whenever the selection changed.
- The window measured itself with `scrollHeight`, which never reports less than the
  current window, so it could only ever grow — leaving empty space at the bottom.
  It now measures its own content and opens at exactly that height.

## 1.1.0

### Fixed
- Columns could come out in the wrong order, or the plugin could finish before any
  text had been created — column creation was fired off asynchronously and never
  awaited. All fonts are now preloaded up front and the columns are built in order.
- Running the plugin without a text layer selected (or on text the splitter couldn't
  match) left an empty frame behind on the canvas. Nothing is created until the input
  has been validated.
- Text with mixed fill colours, mixed fill styles or mixed leading trim threw an
  internal error instead of creating columns.
- Invalid or empty values in the plugin window (blank fields, `0` columns, negative
  numbers) produced a broken regular expression and the plugin silently did nothing.
  Values are now range-checked in the window and clamped again before use.
- A column count that didn't divide the text evenly could produce one extra, nearly
  empty column.
- Text at 0% opacity came out fully opaque.
- The number fields were not actually number fields — a duplicate `type` attribute
  meant they accepted any text.
- The plugin window loaded its font from an external URL, which the manifest's
  `networkAccess: none` blocks. It now uses the system UI font.
- Columns are no longer dropped into an auto layout parent (where they would be
  pulled into the layout) or into a component instance (where the append fails).

### Changed
- Mixed type styles are now preserved. Fonts, sizes, colours, text and fill styles,
  line height, letter spacing, decoration, case, lists, indentation and links are
  copied per character instead of the whole thing being reset to a default font.
- Splitting no longer uses a regular expression. Columns are balanced by walking
  word or paragraph boundaries, so unusual and invisible characters can't break it
  and you always get as many columns as the text can fill.
- Soft returns are preserved rather than deleted (which used to run words together).
- Every failure now explains itself in a Figma notification instead of failing quietly.
- The plugin window follows the Figma light/dark theme, disables the button until a
  text layer is selected, submits on Enter, sizes itself to its content, and
  remembers your settings between runs.
- The whole operation is a single undo step.
- The viewport no longer jumps to a fixed 50% zoom after creating the columns.

## 1.0.0
- Initial release.
