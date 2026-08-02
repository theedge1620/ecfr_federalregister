# eCFR Citation Retriever

A single-page tool for reading the Code of Federal Regulations, tracing each section back to
its Federal Register citations, and comparing how a section changed between two dates. It runs
entirely in the browser against the public eCFR and Federal Register APIs — no build step, no
bundler, no server-side component.

```
ecfr_light/
├── index.html      # markup: sidebar controls + results pane
├── script.js       # all application logic (~1,530 lines, no JS dependencies)
├── style.css       # light "government document" theme
├── static/img/     # (empty placeholder)
└── ecfr_data/      # companion offline tooling — see "Offline variant" below
```

## Running it

Open `index.html` in a browser, or serve the folder with any static file server. Everything
loads live from the eCFR API on startup: the tool fetches the CFR title list, then cascades
into Title 10 / Part 50 at the most recent amendment date.

## Data sources

All API calls are read-only GETs. `ECFR_BASE` is `https://www.ecfr.gov/api/versioner/v1`.

| Endpoint | Purpose |
| --- | --- |
| `GET {ECFR_BASE}/titles.json` | The list of CFR titles that populates every Title dropdown |
| `GET {ECFR_BASE}/versions/title-{n}.json?issue_date[gte]=…` | Every amendment date for a title, with the part and section each one touched. Drives all date dropdowns and their narrowing |
| `GET {ECFR_BASE}/structure/{date}/title-{n}.json` | The title's hierarchy on a given date — parts, subparts, subject groups, sections, appendices |
| `GET {ECFR_BASE}/full/{date}/title-{n}.xml?section=…` | Section XML: heading (`HEAD`), citation line (`CITA`), and paragraphs (`P`) |
| `GET {ECFR_BASE}/full/{date}/title-{n}.xml?appendix=…` | Appendix XML, same shape |
| `GET federalregister.gov/api/v1/documents/{citations}.json` | PDF links and document titles for the FR citations found in a section |

Two constraints worth knowing about the versions endpoint: it rejects unbounded queries with a
"result set too large" error, so the tool always sends `issue_date[gte]` for the last 15 years;
and some snapshots come back anomalous, so `SUPPRESSED_DATES` filters known-bad dates out of the
dropdowns (currently Title 10's 2016 entries).

Outbound links go to `federalregister.gov/citation/…` for FR citations, and to
`ecfr.gov/current/title-{n}/part-{m}` as a fallback when a part cannot be rendered in-app.

## The three modes

| Mode | What it does |
| --- | --- |
| **Section** | Fetches one section's text, its `CITA` line, the FR citations parsed out of it, matching FR PDFs, cross-references, and referenced industry standards |
| **Part** | Renders a part's full structure as a clickable tree — every section and appendix loads into Section mode on click |
| **Diff** | Fetches one section at two dates and renders a word-level, side-by-side comparison with add/remove/unchanged counts |

## How it works

### The cascading controls

Each mode has its own set of selects, prefixed `s-` (section), `p-` (part), or `d-` (diff). They
cascade in one direction:

```
Title → [versions fetch] → Part → Section → Date
```

`onTitleChange()` fetches the title's version records and loads a structure snapshot;
`loadStructure()` populates the Part select and hands off to `onPartChange()`, which populates
the Section select and narrows the Date list to just the dates that part was amended. Picking a
section narrows the dates again to that section's own amendment history.

`openInMode()` is the exception: it drives the same cascade toward a *specific* title/part/
section instead of the defaults, which is how the reading pane's shortcut buttons work. It
populates the date list before loading the structure, so the cascade never swaps the date and
reloads underneath the selection.

### Caching

Three module-level caches keep mode switches cheap: `titlesData` (the title list),
`versionsRaw` (raw version records per title, used for all date filtering), and
`structureCache` (keyed `"{title}-{date}"`).

### Event handling

Generated markup carries **`data-action` attributes**, not inline `onclick` handlers. Two
delegated listeners on `document` dispatch through the `ACTIONS` map, plus one for the paragraph
filter's `change`. Values go into attributes via `actionAttrs()` / `_attrEscape()` and are read
back as plain strings through `dataset` — they are never parsed as JavaScript. This matters
because eCFR labels routinely contain quotes, apostrophes, embedded newlines, and inline markup
like `<sup>` and `<XREF ID="…">`.

`closest('[data-action]')` resolves to the innermost match, so a button nested inside a
clickable row wins without needing `stopPropagation`.

### Paragraph hierarchy

`buildParaPaths()` walks a section's `<P>` elements, classifies each leading designator as
alpha / numeric / roman / upper — `(i)` is only roman when a numeric parent is on the stack —
and builds a full path such as `(a)(1)(i)`. Those paths drive the indent, the bold designator
styling, and the reading pane's paragraph filter.

## Function reference

**Mode and controls** — `setMode`, `populateTitleSelect`, `onTitleChange`, `fetchVersions`,
`loadStructure`, `onPartChange`, `updateDateDropdown`, `datesForPart`, `datesForSection`,
`openInMode`, `selectIfPresent`, `attachDateListeners`

**Fetch and render** — `runQuery` / `runQueryWith`, `renderSection`, `runPartBrowse` /
`runPartBrowseWith`, `renderPartBrowser`, `runDiff` / `runDiffWith`, `renderDiff`, `wordDiff`,
`buildDiffPane`, `loadSection`, `loadAppendix`, `loadCrossRef`

**Parsing** — `buildParaPaths`, `extractTagText`, `findFRMatches`, `extractCrossRefs`,
`extractStandards`, `extractNodes`, `findNode`

**Labels** — `cleanLabel` (strip markup and collapse whitespace), `truncate` (35-char cap),
`appendixShortLabel` (`Appendix A to Subpart B of Part 430—…` → `App. A (Subpt B)`),
`hasCitationNumber`, `partOfSection`

**Reading-pane shortcuts** — `browsePartStructure`, `compareVersionsFor`, `applyParaFilter`,
`ecfrPartLink`

**Events** — `ACTIONS`, `actionAttrs`, `attachActionListeners`, `_attrEscape`

**Search** — `runSearch`, `navigateSearch`, `jumpToReference`, `_highlightInScope`, `_goToMark`

**History** — `loadHistory`, `saveToHistory`, `restoreQuery`, `deleteHistoryItem`,
`clearHistory`, `renderHistory`. Persists the last 25 lookups in `localStorage` under
`ecfr_history`; each entry re-runs live rather than caching results.

**Export** — `exportCitationsCSV` (citations + FR/PDF URLs), `exportSectionRTF` (section text,
respecting the paragraph filter), `exportDiffRTF` (comparison with change marks). All are
client-side blob downloads.

## Recent updates

**Dropdown labels truncate at 35 characters.** `truncate()` caps descriptive titles in the
Part and Section dropdowns and appends `...`; shorter titles render in full. `cleanLabel()`
strips the inline markup and trailing newlines the API returns, which previously rendered as
literal `<em>` / `<sup>` tags and inflated the character count.

**Appendix entries are compact.** The old label logic only stripped `to Part {n}`, so
`Appendix A to Subpart B of Part 430—Uniform Test Method for…` passed through nearly whole and
set the dropdown popup's width. `appendixShortLabel()` reduces it to `App. A (Subpt B)` — the
subpart marker is required, since a part can hold both `Appendix A to Subpart B` and
`Appendix A to Subpart C`.

**Subject-group artifacts suppressed in the Part browser.** The API fills `identifier` with a
generated key (`ECFR092dafdfbddb968`) for subject-group nodes, which was rendering in the
citation-number column. `hasCitationNumber()` detects those and the row renders as a plain
heading instead. Title 10 has 247 such nodes plus one subpart.

**Fixed: appendices were not clickable in the Part browser.** Their `onclick` embedded the
description in a JS string literal, and every eCFR `label_description` ends with a newline —
a syntax error, so the handler never compiled. Descriptions containing a double quote (Title 10
has one with `<XREF ID="…">`) also terminated the attribute early and stripped `role="button"`
off the row.

**All generated markup moved to delegated event handling.** Ten sites converted from inline
handlers to `data-action` attributes. This removed the whole class of escaping bug above and
fixed a second live one: history rows embedded JSON in a single-quoted attribute, so restoring
any entry whose label contained an apostrophe — routine for appendices — silently did nothing.
The static handlers in `index.html` were left alone; they interpolate no data.

**Reading pane gained a shortcut bar.** Above the Citations card: **Browse Part Structure**
(switches to the Part tab, points the controls at this section's part and date, and runs the
browse) and **Compare Versions** (switches to the Diff tab with title, part, and section loaded,
and the dates pre-paired — the version being read against the one immediately before it, or the
one after it when reading the oldest). Compare deliberately stops short of running the
comparison. Appendices show only the Browse button, since the diff API is addressed by section
number.

**Part cross-references open in-app.** A `Part 52` chip under Cross References now loads that
part in the Part tab instead of opening eCFR.gov in a new tab. Cross-title references work too;
the date falls back to that part's latest when the current date does not apply.

**eCFR fallback link on failure.** When a part cannot be rendered — missing from the structure
for that date, or a structure API error — the error banner carries a link to the part on
eCFR.gov. This lives in `runPartBrowseWith()`, so every route into the part browser benefits.

**Paragraph filter moved into the reading pane.** It now sits inline with the two shortcut
buttons instead of in the sidebar, and appears only for sections that actually have paragraph
designators. Because it is rebuilt on every render, its `change` handler is delegated rather
than bound at startup.

## Offline variant (`ecfr_data/`)

A separate, self-contained experiment that serves the same UI from a local SQLite mirror rather
than the live API. Not wired into the main app.

| File | Purpose |
| --- | --- |
| `ecfr_downloader.py` | Downloads every amended version of every section in Title 10 Chapter I (NRC) into SQLite. Deduplicates by SHA-256 so only real text changes are stored; resumable, rate-limited with back-off |
| `ecfr_full_downloader.py` | Same, but stores a snapshot for *every* amendment date — preserving citation-only and administrative changes that left the text identical |
| `server_offline.py` | Local HTTP server exposing JSON endpoints backed by those databases (`python server_offline.py`, default port 8765) |
| `indexoffline.html`, `scriptoffline.js` | The offline viewer front-end |
| `ecfr_title10.db`, `ecfr_title10_full.db` | The downloaded databases (~21 MB and ~24 MB) |

## Notes and limitations

- **Diffing appendices is not supported.** The diff path fetches by `section=`, which an appendix
  identifier is not valid for. Appendices still appear in the Diff tab's own section dropdown and
  will fail there — a pre-existing gap, not yet addressed.
- **Cross-reference and standards detection is regex-based** over the section text
  (`extractCrossRefs`, `_extractStandardsFromText`, with a fixed list of 27 standards bodies in
  `_STD_ORGS`). It is deliberately generous and can miss unusual phrasings.
- **Fonts load from Google Fonts** (`index.html`), so typography degrades to system fallbacks
  without a network connection. The application logic itself has no third-party dependencies.
- **Dates are eCFR issue dates**, not effective dates. The `★ latest` marker means most recent
  available snapshot.
- The eCFR fallback link points at `/current/`, since eCFR exposes no stable public URL for an
  arbitrary past date.
