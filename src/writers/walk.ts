import { Tag, type RenderableTreeNode } from "@markdoc/markdoc";

export const cls = (n: RenderableTreeNode, c: string) =>
  Tag.isTag(n) && String(n.attributes.class ?? "").split(" ").includes(c);

export const tags = (nodes: RenderableTreeNode[]) => nodes.filter(Tag.isTag) as Tag[];

export const text = (n: RenderableTreeNode): string =>
  typeof n === "string" ? n : Tag.isTag(n) ? n.children.map(text).join("") : Array.isArray(n) ? n.map(text).join("") : "";

const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
export const superscript = (s: string) => [...s].map((c) => SUP[c] ?? c).join("");

/** The language spans/divs of a bilingual element, if any. */
export function languages(node: Tag) {
  const kids = tags(node.children);
  return { pali: kids.find((k) => cls(k, "pali")), english: kids.find((k) => cls(k, "english")) };
}

const BLOCK = new Set(["p", "div", "ol", "ul", "h1", "h2", "h3", "h4", "header"]);
/** True when a list item holds only inline content (tight list). */
export const isInline = (nodes: RenderableTreeNode[]) => !nodes.some((n) => Tag.isTag(n) && BLOCK.has(n.name));
