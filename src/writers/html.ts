import Markdoc from "@markdoc/markdoc";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Rendered } from "../load";
import type { Show } from "../options";

const CSS = readFileSync(join(import.meta.dir, "..", "..", "assets", "style.css"), "utf8");

const TOGGLES = `<nav class="toggles">
  <label><input type="checkbox" checked data-hide="pali"> Pāli</label>
  <label><input type="checkbox" checked data-hide="english"> English</label>
</nav>
<script>
document.querySelectorAll("nav.toggles input").forEach((box) =>
  box.addEventListener("change", () => document.body.classList.toggle("hide-" + box.dataset.hide, !box.checked)));
</script>`;

const RUN_ON = new Set(["parajika", "sanghadisesa", "aniyata", "nissaggiya", "pacittiya", "patidesaniya", "sekhiya", "adhikarana-samatha", "conclusion"]);

export function chapterSections(chapters: Rendered[]) {
  return chapters.map(({ chapter, tree }) => {
    const cls = RUN_ON.has(chapter.slug) ? "chapter continue" : "chapter";
    return `<section class="${cls}" id="${chapter.slug}" data-title="${chapter.title}">\n${Markdoc.renderers.html(tree.children)}\n</section>`;
  });
}

export function toHtml(chapters: Rendered[], show: Show, opts: { title: string; standalone?: boolean; embedCss?: boolean }) {
  const both = show.pali && show.english;
  const lang = show.pali && !show.english ? "pi" : "en";
  const body = chapterSections(chapters).join("\n");
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title}</title>
${opts.embedCss === false ? "" : `<style>\n${CSS}</style>`}
</head>
<body class="${both ? "both" : ""}">
${both && opts.standalone !== false ? TOGGLES : ""}
${body}
</body>
</html>
`;
}

export { CSS };
