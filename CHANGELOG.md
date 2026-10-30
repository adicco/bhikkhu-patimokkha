# Changelog

What changed in each release of the PDFs, EPUBs, HTML and Markdown. Add to **Unreleased** as
you go; `bun run publish` uses it as the release notes and then files it under the release's
tag. Left empty, the notes list the commit messages since the last release. Changes that only
affect the website (the occasion picker and the PDFs it builds on demand) go under **Website**
instead: they reach readers when the site is redeployed, not in a release.

## Website

**30 October 2026 — Season-telling in English**: When the site builds the text for a particular uposatha, the English now gives that uposatha's count ("two Uposathas have passed; five Uposathas remain") instead of the book's "seven Uposathas remain", which is only right for the first uposatha of the cold season. The book gives no English for these counts, so they follow the wording of the passage itself. The released PDFs, EPUBs and Markdown print the book's own reading and are unchanged.

## Unreleased

**A6 booklet**: A new pocket-sized PDF, in all three languages, also offered for a single uposatha on the website. It is printed on A4: four A6 pages to each side of a sheet. The first sheet is a guide with a picture of the first sheet of pages. It explains how to print double-sided (flip on the long edge), cut the stack down the middle between the cut marks, put the right-hand pile under the left-hand one, then fold and staple. As in the A5 booklet, the Pāli and English are on facing pages. At 13pt the Pāli alone makes an 88-page booklet from 11 sheets of A4. The English takes 13 sheets and both languages together take 27, which is too thick to staple in one piece.

## v2026.10.29.1 (29 October 2026)

**PDF page breaks**: A section heading (Pārājika, Saṅghādisesa, …) no longer sits at the foot of a page with only a line or two under it; if there isn't room for the heading and a few lines of its text, it starts on the next page. A rule of three lines or fewer is no longer split across two pages, and no page now begins or ends with a single stray line of a paragraph. This works the same in A4, A5 and the booklet, since it is worked out page by page as the PDF is made. Some pages end a few lines short as a result.

## v2026.10.13.1 (13 October 2026)

**PDF line breaks**: Pāli words are no longer broken by the English hyphenation rules (_man-asikaroma_, _up-osatha_). Pāli now breaks only at the hyphens the book prints between the parts of a compound (_uposatha-kammaṁ_), including Pāli words quoted in the English (_Uposatha hall_). The Pāli is set ragged-right, with even spaces between words, rather than justified; centred lines stay centred and the English stays justified.

## v2026.10.12.2 (12 October 2026)

**EPUB fixes**: The title and author no longer turn into "P�����imokkha" in builds from the website. Table-of-contents links now open the right chapter in readers such as Lithium, which showed "Content missing" because chapter anchors contained diacritics (`#pārājika`). All three EPUBs now pass epubcheck (a duplicate `nidana` id is gone).

## v2026.10.12.1 (12 October 2026)

**v1.2**: Switch to 13pt as the base font size for PDF renderings (Pāli, Pāli and English, and English), as 12pt might be too small for a number of students; the English beside or under the Pāli goes up to 12pt.

**v1.1**: Text corrections from a comparison with the Sasanarakkha Thai Dhammayut text: Saṅghādisesa 5 _itthī-matiṁ_, Saṅghādisesa 12 _saṁvaḍḍhā_; Notes 4 keeps the book's "uposathās" as a marked misprint.

**v1.0**: Multiple builds and setting up GitHub Releases
