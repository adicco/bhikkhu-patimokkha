# Changelog

What changed in each release of the PDFs, EPUBs, HTML and Markdown. Add to **Unreleased** as
you go; `bun run publish` uses it as the release notes and then files it under the release's
tag. Left empty, the notes list the commit messages since the last release.

## Unreleased

## v2026.10.13.1 (13 October 2026)

**PDF line breaks**: Pāli words are no longer broken by the English hyphenation rules (_man-asikaroma_, _up-osatha_). Pāli now breaks only at the hyphens the book prints between the parts of a compound (_uposatha-kammaṁ_), including Pāli words quoted in the English (_Uposatha hall_).

## v2026.10.12.2 (12 October 2026)

**EPUB fixes**: The title and author no longer turn into "P�����imokkha" in builds from the website. Table-of-contents links now open the right chapter in readers such as Lithium, which showed "Content missing" because chapter anchors contained diacritics (`#pārājika`). All three EPUBs now pass epubcheck (a duplicate `nidana` id is gone).

## v2026.10.12.1 (12 October 2026)

**v1.2**: Switch to 13pt as the base font size for PDF renderings (Pāli, Pāli and English, and English), as 12pt might be too small for a number of students; the English beside or under the Pāli goes up to 12pt.

**v1.1**: Text corrections from a comparison with the Sasanarakkha Thai Dhammayut text: Saṅghādisesa 5 _itthī-matiṁ_, Saṅghādisesa 12 _saṁvaḍḍhā_; Notes 4 keeps the book's "uposathās" as a marked misprint.

**v1.0**: Multiple builds and setting up GitHub Releases
