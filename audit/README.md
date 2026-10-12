# Transcription audit

Source: `BhikkhuPaṭimokkha.Pāli-English.Ṭhānissaro.pdf` (192 pp., Adobe ClearScan of the
2008 Metta Forest Monastery printing). PDF page = book page + 4.

The PDF's text layer is OCR and unusable for Pāli: ṁ comes out as `rh`/`ril`/`riz`, ñ as `ft`/`fi`,
and dots below are dropped. So the Pāli was **typed from the page images**, not copied from
the OCR.

## Checks performed

1. **Visual proofread, word by word.** Every Pāli page (book pp. 4–12, 14–23, 24–162,
   164–188) was compared against the built Pāli text, using page images at 230 dpi. Any
   uncertain ī/i, ā/a, ṭ/t, ḷ/l or ṁ/m was re-checked at 400–500 dpi.
2. **Dictionary.** Every Pāli word was looked up in DPD (`bun run check`). Unresolved words
   are listed below; each one matches the printed book.
3. **English vs OCR.** The English (book pp. 1–163) was diffed letter by letter against
   the OCR text layer, after stripping diacritics. Every difference turned out to be an
   OCR artefact (`m`→`rn`, dropped "I", running heads).
4. **Structure.** Rule counts and numbering: 4 / 13 / 2 / 30 / 92 / 4 / 75 / 7. Unicode is
   NFC. Only the expected letters appear (`ṁ`, never `ṃ`).

## Errors in my first transcription, found and fixed by the proofread

| where | first typed | book |
|---|---|---|
| Pubba-kicca | Imasmiṁ-pana | Imasmim-pana |
| Pubba-kicca | sāmaggīnam-aññataro | sāmaggīnamaññataro (the hyphen is a line break) |
| Nidāna | evam-evaṁ | Evam-evaṁ |
| Saṅghādisesa 3, 4 | methunūpasaṁhitāhi / -ena | methunūpasañhitāhi / -ena |
| Saṅghādisesa (end) | cha-rattaṁ | chārattaṁ (printed `chā-` + `rattaṁ` across a line break) |
| Aniyata 2 | nālaṁ-kammaniyaṁ | nālaṁkammaniyaṁ |
| Nissaggiya 7 | abhihaṭṭhuṁ pavāreyya | abhihaṭṭhum-pavāreyya |
| Nissaggiya 15 | Nisīdana-santhataṁ-pana | Nisīdana-santhatam-pana |
| Nissaggiya 27 | viyyati | vīyati |
| Nissaggiya 29 | cha-ratta-paraman-tena | chāratta-paraman-tena |
| Pācittiya 19 | aggaḷaṭṭhapanāya | aggalaṭṭhapanāya |
| Pācittiya 29 | bhikkhuni-paripācitaṁ | bhikkhunī-paripācitaṁ |
| Pācittiya 56 | visivan'āpekkho | visīvan'āpekkho |
| Pācittiya 63 | nihatādhikaraṇaṁ | nīhatādhikaraṇaṁ |
| Sekhiya 47 | hattha-niddhunakaṁ | hattha-niddhūnakaṁ |
| Sekhiya 66 | veṭhita-sīsassa | veṭṭhita-sīsassa |
| Ovāda-pāṭimokkha | Khanti … titikkhā | Khantī … tītikkhā |
| Pavāraṇā | bhikkhuninam (×2) | bhikkhunīnam |
| Notes, numbers 59–68, 72 | saṭṭhi…, dvāsattati | saṭṭhī…, dvasattati |

## Readings in the book that look like typos

These are kept as printed and marked with `{% sic %}`. `bun run build -- --corrections`
substitutes the suggested reading instead.

| where | printed | suggested |
|---|---|---|
| Pārājika 2 | muḷho'si | mūḷho'si |
| Saṅghādisesa 13 (2nd list) | chanda-gamino | chanda-gāmino |
| Adhikaraṇa-samatha | Uppannunānaṁ | Uppannuppannānaṁ |
| After the Pāṭimokkha | samma-sambuddhassa | sammā-sambuddhassa |
| Pavāraṇā pubba-kicca | suriya-lokassa | suriy'ālokassa |
| Pavāraṇā pubba-kicca | dhāretabbam, yuttarūpam | dhāretabbaṁ, yuttarūpaṁ |
| Notes 4 | sattā ca uposathā | satta ca uposathā |

Two printing slips that don't affect pronunciation were silently normalised:
`upo-sathaṁ` (Nidāna: a stray mid-line hyphen) and the misplaced closing quote in
`ekenā " ti` (NP 9).

## Words DPD doesn't resolve (all checked against the book)

anumānetabbo / anumānetabbā, paññapanañ-ca, pattakallattaṁ, paṭikkarissāmi,
saṅgha-pavāraṇārahā, veṭṭhita-sīsassa, plus the `sic` readings muḷho'si and Uppannunānaṁ.

## Readings for a particular occasion

Custom builds (`--season`, `--bhikkhus` …, see the main README) substitute readings marked with
`{% slot %}`. Wrapping text in slots changed no printed text: with no occasion set, the Markdown
and LaTeX outputs are byte-identical to the earlier ones, and the HTML differs only by the slot
spans. The Pāli substitutes are taken verbatim from the notes (test/occasion.test.ts checks every
one against the notes chapter and the Pavāraṇā chapter). Note 4's *sattā* is substituted with
its `{% sic %}`, so it prints as the book has it unless `--corrections` is given.

English: the book glosses only some of these readings. Where a note gives a gloss, it is used;
otherwise the English is left as printed (and the HTML marks it `unglossed`). Choices made in
fitting the glosses into the sentence, all in `src/occasion.ts`:

- Note 1 (night): the gloss "Of the first four…" is set as **"The first four"**, replacing
  "With regard to the first four of these, there is no lamp-duty … The remaining three", so that
  the sentence reads "The first four have been done by bhikkhus who know…".
- Note 3 (season): "summer" and "rainy season" come from the passage's own list ("winter,
  summer, and the rainy season"), not from the note's wording ("hot season").
- Note 4: the glosses are fitted after "in this season" as "there are seven uposathas and one
  pavāraṇā" and "there are, because of the additional month, ten [nine] uposathas (and one
  pavāraṇā)", lower-cased as in the notes.
- Note 6: the English count is the note's numeral ("12 bhikkhus"); four stays "four".
- Address: "Venerable sirs [friends]" becomes "Friends" when the senior bhikkhu gives the motion.
- Not glossed, so left as printed: note 5's counts ("seven Uposathas remain"), the Pavāraṇā's
  "with three statements", and "fifteenth [fourteenth]" on a harmony Pavāraṇā.

## Not covered as thoroughly

- The English of book pp. 164–188 (after-Pāṭimokkha translations, group uposatha and
  pavāraṇā instructions) and the foreword were typed from page images but not diffed
  against OCR. The Pāli on those pages *was* proofread.
- Layout details of the book (line breaks in prose, page breaks) are not reproduced.
