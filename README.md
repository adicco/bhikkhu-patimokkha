# Bhikkhu Pāṭimokkha — Pāli / English in Markdoc

The *Bhikkhu Pāṭimokkha* (Pāli–English edition, tr. Ṭhānissaro Bhikkhu, Metta Forest
Monastery 2008), transcribed into [Markdoc](https://markdoc.dev) so that the Pāli and the
English live in separate components and can be shown, hidden or built separately.

## Build

```sh
bun install
bun run build                      # all targets, bilingual  → dist/both/
bun run build -- --lang pali       # Pāli only               → dist/pali/
bun run build -- --lang english    # English only            → dist/english/
bun run build:all                  # all three languages
bun run build -- md pdf --lang pali --paper a4 --size 13
```

Targets: `md` (one file per chapter in `md/` plus a combined file), `html` (single page; the
bilingual build has Pāli/English toggles), `epub` (via pandoc, Gentium Plus embedded) and
`pdf` (LuaLaTeX, Gentium Plus; bilingual builds set Pāli and English in parallel columns).

| option | default | |
|---|---|---|
| `--lang pali\|english\|both` | `both` | which language(s) to include |
| `--notes` / `--no-notes` | on unless `pali` | the Preliminary Duties notes chapter |
| `--instructions` / `--no-instructions` | on unless `pali` | English rubrics for group uposatha, pavāraṇā |
| `--corrections` | off | substitute suggested readings for the book's apparent typos (see `{% sic %}`) |
| `--paper a4\|a5`, `--size N` | A4 for bilingual, A5 otherwise; 12pt Pāli, 11pt otherwise | PDF only |

Requires Bun, pandoc (EPUB) and LuaLaTeX with Gentium Plus (PDF).

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
