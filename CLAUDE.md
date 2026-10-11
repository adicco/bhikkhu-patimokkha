# patimokkha

Markdoc transcription of the Bhikkhu Pāṭimokkha (Pāli–English, tr. Ṭhānissaro Bhikkhu) with
Bun build scripts. See README.md for the component list and build options.

- Use Bun (`bun run build`, `bun run check`, `bun test`), not Node/npm.
- The text is chanted: diacritics are the whole point. Never "fix" a Pāli spelling from
  memory or from another edition. The printed book is the source of truth. If the book looks
  wrong, keep its reading and wrap it in `{% sic correction="…" %}`.
- After any content change, run `bun run check` and `bun test`. The DPD lookup must not gain
  new unresolved words without a reason recorded in audit/README.md.
- Niggahīta is `ṁ` (never `ṃ`). Keep files NFC. Type `'` and `"` as ASCII; the build
  makes them typographic.
- Sandhi `-m-` before a vowel or `p` is how the book prints some forms (`Imasmim-pana`,
  `Nisīdanam-pana`, `abhihaṭṭhum-pavāreyya`); don't normalise these to `ṁ`.
- Writers live in src/writers/ and all walk the same Markdoc render tree; new tags need
  handling in markdown.ts, latex.ts and (via CSS) assets/style.css.
