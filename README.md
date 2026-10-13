# Bhikkhu Pāṭimokkha — Pāli / English in Markdoc

The *Bhikkhu Pāṭimokkha* (Pāli–English edition, tr. Ṭhānissaro Bhikkhu, 2008;
printed by Palelai Buddhist Temple, Singapore), transcribed into [Markdoc](https://markdoc.dev) so that the Pāli and the
English live in separate components and can be shown, hidden or built separately.

## Build

```sh
bun install
bun run build                      # all targets, bilingual  → dist/both/
bun run build -- --lang pali       # Pāli only               → dist/pali/
bun run build -- --lang english    # English only            → dist/english/
bun run build:all                  # all three languages
bun run build -- md pdf --lang pali --paper a4 --size 13
bun run build -- pdf --paper booklet --signature 16
bun run build -- --help             # every option
```

Targets: `md` (one file per chapter in `md/` plus a combined file), `html` (single page; the
bilingual build has Pāli/English toggles), `epub` (via pandoc, Gentium Plus embedded) and
`pdf` (LuaLaTeX, Gentium Plus).

The `pdf` target writes three files by default:

| file | |
|---|---|
| `….a4.pdf` | A4 pages |
| `….a5.pdf` | A5 pages |
| `….a5-booklet.pdf` | A5 pages imposed two-up on A4 landscape in booklet order: print double-sided, **flip on short edge**, fold the stack in half and staple or sew at the fold |

In bilingual builds, the A4 and A5 PDFs put each passage's English under its Pāli in a smaller,
grey type; `--columns` sets them side by side instead. The booklet follows the printed book: Pāli
on the left page, the English on the facing right page, the two kept level passage by passage.

| option | default | |
|---|---|---|
| `--lang pali\|english\|both` | `both` | which language(s) to include |
| `--notes` / `--no-notes` | on unless `pali` | the Preliminary Duties notes chapter |
| `--instructions` / `--no-instructions` | on unless `pali` | English rubrics for group uposatha, pavāraṇā |
| `--corrections` / `--no-corrections` | on | substitute suggested readings for the book's apparent typos (see `{% sic %}`); `--no-corrections` prints the book's own |
| `--paper a4,a5,booklet` | all three | which PDFs to make (comma-separated) |
| `--columns` | off | bilingual A4/A5: Pāli and English in parallel columns |
| `--signature N` | one booklet | split the booklet into folded gatherings of N pages (a multiple of 4) for sewing |
| `--size N` | 13pt | PDF font size; English beside or under the Pāli is 12/13 of it (12pt) |
| `--chapters slug,…` | all | only these chapters (slugs from the front matter, e.g. `pubba-kicca,nidana`) |

Requires Bun, pandoc (EPUB) and LuaLaTeX with Gentium Plus (PDF).

### A copy for one occasion

These options fill in the readings that change from one uposatha to the next. Unset, the book's
printed readings (and its bracketed alternatives) are kept. Every substituted Pāli reading is
taken from the book: the Preliminary Duties notes, the bracketed alternatives such as
*paṇṇaraso [cātuddaso]*, and the Pavāraṇā chapter's notes and instructions (`src/occasion.ts`;
the tests check each reading against the notes). English comes from the notes' glosses where
they give one; otherwise the printed English is kept, and the HTML marks it `unglossed`.

| option | book source | |
|---|---|---|
| `--time day\|night` | note 1 | night: *Tattha purimāni cattāri* |
| `--helpers bhikkhus\|samaneras\|aramikas` | note 2 | who did the preliminary tasks |
| `--season hemanta\|gimha\|vassana` | note 3 | |
| `--adhika` | notes 4, 5, p1 | a season with an additional month |
| `--fortnight N` | note 5 | which uposatha of the season (the Pavāraṇā's place is refused) |
| `--bhikkhus N[:form]` | note 6 | number present; `12:2` picks the book's second form (*bārasa*) |
| `--day fifteenth\|fourteenth\|harmony` | brackets; Pavāraṇā instruction | *harmony* (*sāmaggī*) for the Pavāraṇā only |
| `--address bhante\|avuso` | brackets | *āvuso* when the most senior bhikkhu gives the motion |
| `--statements three\|two\|one` | Pavāraṇā instruction | *te-*, *dve-*, *eka-vācikaṁ* |

```sh
bun run build -- pdf --paper a5 --chapters pubba-kicca,nidana \
  --season gimha --adhika --fortnight 9 --bhikkhus 22 --time night
```

## Release and the distribution site

```sh
bun run release      # every standard build → dist/site/ (files/, manifest.json, index.html)
bun run serve        # the site plus custom builds on :3000 (PORT, HOST, SITE_DIR, … in src/serve.ts)
bun run site         # regenerate dist/site/index.html alone from its manifest.json
bun run publish      # build, then publish as a GitHub release; notes from CHANGELOG.md "## Unreleased" (--dry-run, --draft, --help)
```

`release` builds the three languages in every format, zips the Markdown, and copies each file
to `dist/site/files/` under its build name (`dist/<lang>/bhikkhu-patimokkha.v<version>.<languages>[.<format>].<ext>`)
with its hash added before the extension:
`bhikkhu-patimokkha.v1.0.pali.eng.a4.a545767bd6.pdf`, `….pali.only.a5-booklet.….pdf`,
`….eng.only.….epub`, `….pali.eng.md.….zip`. The version is the text's, from
`content/edition.json`: bump it when the text changes. The hash is the file's own content hash,
so a change to one format's design renames only that format's files. The index page links to
those names, so they can be cached forever. Builds are reproducible (`SOURCE_DATE_EPOCH` defaults to the last
commit's time, and the PDF and EPUB identifiers are derived from their source), so text that
hasn't changed keeps its file names from one release to the next.

The index page offers the release files and a form for a copy prepared for one occasion. The
form fills in season, extra month, which uposatha and the 14th/15th from
`data/mahanikaya.csv` (the [Splendid Moons](https://splendidmoons.github.io/) Mahānikāya
calendar, 2000–2100; in that reckoning the extra month always falls in the hot season), shows
the changed passages as they will be recited, and builds the file on the server
(`POST /api/build`, queued, time-limited and cached by options and source text).

### Testing the site

```sh
bun test            # unit tests (test/): content, occasions, calendar
bun run test:e2e    # browser tests (e2e/), about a minute
```

The end-to-end tests start the real server on a free port with a site generated for a fixed
date (12 October 2026; the browser clock is pinned to match) and drive it in headless Chromium:

- `e2e/page.e2e.test.ts`: the downloads table and its hashed links; every calendar date filling
  in the form; which questions each ceremony and format asks; note 5's and note 6's choices;
  the preview's text for every option (expected Pāli typed from the book's notes), its
  highlighting, layout and type size; chapter presets, "build alone" and Reset; the command
  line; the page without its server; a phone-width layout; the API's validation.
- `e2e/builds.e2e.test.ts`: real builds from the form (A5, A4 in columns, a Pāli booklet in
  sections, type sizes, EPUB, HTML with and without instructions, zipped Markdown, English
  only), each downloaded and opened with pdftotext/pdfinfo/unzip; and the build cache.

They need `playwright-core`'s headless Chromium (`bunx playwright-core install
chromium-headless-shell`, or point `CHROMIUM_PATH` at a Chromium) and, for the builds,
LuaLaTeX, pandoc, zip, unzip and poppler's pdftotext/pdfinfo.

### Deploying

The `Dockerfile` (Debian 13: Bun, pandoc 3, LuaLaTeX, Gentium Plus) runs the release when the
image is built and serves the site with `bun src/serve.ts`. On the VPS:

```sh
git pull && scripts/deploy.sh      # docker compose build + up -d, with SOURCE_DATE_EPOCH from git
```

`compose.yaml` listens on `127.0.0.1:3000`; put a TLS proxy in front (e.g. Caddy:
`patimokkha.example.org { reverse_proxy 127.0.0.1:3000 }`). Custom builds are cached in the
`build-cache` volume. `BUILD_CONCURRENCY` (default 1) sets how many LaTeX runs share the CPU.

## Content

`content/NN-slug.md`, one file per chapter:

| file | |
|---|---|
| `00-front` | title, foreword, epigraph |
| `01-pubba-kicca`, `02-pubba-kicca-notes` | preliminary duties and their notes (season-telling tables, numbers) |
| `03-nidana` … `11-adhikarana-samatha` | the Pāṭimokkha itself, one file per class of rule |
| `12-conclusion` | the closing summary |
| `13-after-patimokkha` | chants after the recitation |
| `14-group-uposatha`, `15-pavarana` | uposatha for 1–3 bhikkhus; the Pavāraṇā |

### Components

```markdoc
{% rule class="pacittiya" n=1 %}
{% pali %}
Sampajāna-musāvāde pācittiyaṁ.
{% /pali %}
{% english %}
A deliberate lie is to be confessed.
{% /english %}
{% /rule %}
```

| tag | meaning |
|---|---|
| `pali`, `english` | the two languages; each build keeps one or both |
| `passage`, `rule` | an aligned Pāli/English pair (`rule` adds class + number) |
| `heading`, `response`, `rubric`, `vagga` | short pairs given as `pali="…" english="…"` attributes |
| `instruction` | English directions (group uposatha, pavāraṇā) |
| `lines`, `stanza`, `indent`, `list` | line-by-line layout for chants and verses (`\` ends a line) |
| `var` | a word that changes with the occasion; `note="n"` links it to its note |
| `slot` | where an occasion substitutes a reading (`name="season"` etc.); bracketed alternatives carry theirs as attributes (`fifteenth="paṇṇaraso" fourteenth="cātuddaso"`) |
| `changed` | the words that differ in the Pavāraṇā version (small caps in the book) |
| `call`, `lead` | a leader's call (`Handa mayaṁ…`) and the leader's opening words (`[Namo tassa]`) |
| `sic` | a reading printed in the book that looks like a typo; `correction="…"` |
| `note`, `season-table`, `numbers` | the notes chapter |

Text conventions: niggahīta is `ṁ` (as in the book); apostrophes and quotes are typed as
ASCII `'` and `"` and become typographic quotes at build time; NFC throughout.

## Checking the Pāli

```sh
bun run check      # writes audit/check-report.md
bun test
```

`check` validates the schema, rule counts and numbering, the character set, flags word-final
`m`, looks every Pāli word up in the Digital Pāḷi Dictionary (`DPD_DB`, default
`~/Downloads/dpd.db`) and lists every `{% sic %}` reading. See `audit/README.md` for how the
transcription was proofread against the printed book.
