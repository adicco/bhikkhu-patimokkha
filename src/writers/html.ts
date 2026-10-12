import Markdoc, { Tag, type RenderableTreeNode } from "@markdoc/markdoc";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Rendered } from "../load";
import type { Show } from "../options";
import { cls, languages, tags } from "./walk";

const CSS = readFileSync(join(import.meta.dir, "..", "..", "assets", "style.css"), "utf8");

const LANG_TOGGLES = `<label><input type="checkbox" checked data-hide="pali"> Pāli</label>
  <label><input type="checkbox" checked data-hide="english"> English</label>`;

/** Top bar: Pāli/English toggles (bilingual builds) and the light/dark switch. */
const toggles = (both: boolean) => `<nav class="toggles">
  ${both ? LANG_TOGGLES : ""}
  <button type="button" id="theme" aria-label="Switch light/dark"></button>
</nav>
<script>
document.querySelectorAll("nav.toggles input").forEach((box) =>
  box.addEventListener("change", () => document.body.classList.toggle("hide-" + box.dataset.hide, !box.checked)));
const root = document.documentElement, themeButton = document.getElementById("theme");
const dark = () => root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
const label = () => { themeButton.textContent = dark() ? "Light" : "Dark"; };
themeButton.addEventListener("click", () => {
  root.dataset.theme = dark() ? "light" : "dark";
  try { localStorage.setItem("theme", root.dataset.theme); } catch {}
  label();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", label);
label();
</script>`;

/** Applies a saved light/dark choice before the page paints. */
const THEME_HEAD = `<script>try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch {}</script>`;

const RUN_ON = new Set(["parajika", "sanghadisesa", "aniyata", "nissaggiya", "pacittiya", "patidesaniya", "sekhiya", "adhikarana-samatha", "conclusion"]);

export function chapterSections(chapters: Rendered[]) {
  return chapters.map(({ chapter, tree }) => {
    const cls = RUN_ON.has(chapter.slug) ? "chapter continue" : "chapter";
    return `<section class="${cls}" id="${chapter.slug}" data-title="${chapter.title}">\n${Markdoc.renderers.html(tree.children.map(defined))}\n</section>`;
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
${opts.standalone !== false ? THEME_HEAD : ""}
</head>
<body class="${both ? "both" : ""}">
${opts.standalone !== false ? toggles(both) : ""}
${body}
</body>
</html>
`;
}

export { CSS };

/**
 * Prepares the render tree for HTML:
 * - Markdoc's renderer prints unset attributes as "undefined", so they are dropped;
 * - a bilingual passage whose Pāli and English have the same number of paragraphs is split into
 *   rows (Pāli paragraph | its English), so each pair starts level in the two-column grid.
 */
function defined(n: RenderableTreeNode): RenderableTreeNode {
  if (!Tag.isTag(n)) return n;
  const attributes = Object.fromEntries(Object.entries(n.attributes).filter(([, v]) => v !== undefined && v !== null));
  const kids = n.children.map(defined);
  if (cls(n, "passage")) {
    const out = new Tag(n.name, attributes, kids);
    const { pali, english } = languages(out);
    const [ps, es] = [pali && tags(pali.children), english && tags(english.children)];
    if (ps && es && ps.length > 1 && ps.length === es.length && pali!.children.length === ps.length && english!.children.length === es.length) {
      const rows = ps.map((p, i) => new Tag("div", { class: "row" }, [
        new Tag("div", pali!.attributes, [p]),
        new Tag("div", english!.attributes, [es[i]!]),
      ]));
      return new Tag(n.name, attributes, kids.flatMap((k) => (k === pali ? rows : k === english ? [] : [k])));
    }
    return out;
  }
  return new Tag(n.name, attributes, kids);
}
