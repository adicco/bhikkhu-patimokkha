/**
 * The passages that change with the occasion, rendered as HTML for the index page's preview:
 * from each passage, only the paragraphs (or line groups) that contain a slot. The preview follows
 * the first chapter chosen (front matter and notes aside): the ceremony's own chapters show their
 * slots; any other chapter shows its slots if it has any, else its opening passages in full.
 */
import Markdoc, { Tag, type RenderableTreeNode } from "@markdoc/markdoc";
import { loadChapters, render, type Chapter } from "./load";
import type { Occasion } from "./occasion";
import { showFor, type Lang } from "./options";
import { cls } from "./writers/walk";

export const CEREMONIES = {
  uposatha: ["pubba-kicca", "nidana"],
  pavarana: ["pavarana"],
  group: ["group-uposatha"],
} as const;
export type Ceremony = keyof typeof CEREMONIES;

const hasSlot = (n: RenderableTreeNode): boolean =>
  Tag.isTag(n) && (cls(n, "slot") || n.children.some(hasSlot));

function excerpt(nodes: RenderableTreeNode[]): Tag[] {
  const out: Tag[] = [];
  for (const n of nodes) {
    if (!Tag.isTag(n) || cls(n, "note")) continue;
    if (cls(n, "passage")) {
      const langs = n.children.filter(Tag.isTag).map((l) =>
        new Tag(l.name, l.attributes, l.children.filter((c) => hasSlot(c))))
        .filter((l) => l.children.length);
      if (langs.length) out.push(new Tag("div", { class: "passage" }, langs));
    } else if (n.name === "section" || n.name === "article") {
      out.push(...excerpt(n.children));
    }
  }
  return out;
}

const OPENING = 3;

function opening(nodes: RenderableTreeNode[]): Tag[] {
  return nodes.filter((n): n is Tag => Tag.isTag(n) && cls(n, "passage")).slice(0, OPENING);
}

let chapters: Chapter[] | undefined;

export function previewHtml(ceremony: Ceremony, occasion: Occasion, lang: Lang, chosen?: string[]) {
  chapters ??= loadChapters();
  const own: readonly string[] = CEREMONIES[ceremony];
  const first = chapters.find((c) => (chosen ?? own).includes(c.slug) && c.slug !== "front" && c.kind !== "notes");
  if (!first) return `<p class="empty">No preview</p>`;
  const show = showFor(lang, { notes: false, instructions: false });
  if (own.includes(first.slug)) {
    const rendered = render(chapters, show, occasion, own.filter((s) => !chosen || chosen.includes(s)));
    return Markdoc.renderers.html(rendered.flatMap((r) => excerpt(r.tree.children)));
  }
  const children = render(chapters, show, occasion, [first.slug])[0]?.tree.children ?? [];
  const slots = excerpt(children);
  return Markdoc.renderers.html(slots.length ? slots : opening(children));
}
