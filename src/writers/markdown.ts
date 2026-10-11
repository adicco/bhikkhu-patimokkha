import { Tag, type RenderableTreeNode } from "@markdoc/markdoc";
import type { Rendered } from "../load";
import type { Show } from "../options";
import { cls, isInline, languages, superscript, tags } from "./walk";

/** Plain, readable CommonMark. English is set as a blockquote when shown alongside Pāli. */
export function toMarkdown(chapters: Rendered[], show: Show): { slug: string; file: string; markdown: string }[] {
  const both = show.pali && show.english;

  function inline(n: RenderableTreeNode): string {
    if (typeof n === "string") return n;
    if (!Tag.isTag(n)) return Array.isArray(n) ? n.map(inline).join("") : "";
    const inner = () => n.children.map(inline).join("");
    switch (n.name) {
      case "em": return `*${inner()}*`;
      case "strong": return `**${inner()}**`;
      case "br": return "\\\n";
      case "sup": return superscript(inner());
    }
    if (cls(n, "num")) return `**${inner()}**`;
    if (cls(n, "call")) return `*${inner()}*`;
    if (cls(n, "lead")) return `[${inner()}]`;
    if (cls(n, "indent")) return "  ";
    if (cls(n, "changed")) return inner().toUpperCase();
    if (cls(n, "var")) return `*${inner()}*`;
    if (cls(n, "rubric")) return `*(${pairText(n, " / ")})*`;
    return inner();
  }

  function pairText(n: Tag, sep: string) {
    const { pali, english } = languages(n);
    return [pali, english].filter(Boolean).map((t) => inline(t!)).join(sep);
  }

  const item = (li: Tag) => (isInline(li.children) ? li.children.map(inline).join("") : blocks(li.children).join(" "));

  const quote = (s: string) => s.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n");

  function blocks(nodes: RenderableTreeNode[]): string[] {
    return nodes.flatMap((n) => block(n)).filter((s) => s.trim() !== "");
  }

  function block(n: RenderableTreeNode): string[] {
    if (typeof n === "string") return n.trim() ? [n] : [];
    if (!Tag.isTag(n)) return [];
    const kids = n.children;
    if (/^h[1-6]$/.test(n.name)) {
      const level = Number(n.name[1]);
      return [`${"#".repeat(level)} ${tags(kids).map((k) => inline(k)).join(" — ") || kids.map(inline).join("")}`];
    }
    if (cls(n, "response")) return [`*( ${pairText(n, " )* / *( ")} )*`];
    if (cls(n, "rubric")) return [`*( ${pairText(n, " )* / *( ")} )*`];
    if (cls(n, "vagga")) return [pairText(n, " — ")];
    switch (n.name) {
      case "p": return [kids.map(inline).join("")];
      case "ol": return [tags(kids).map((li, i) => `${i + 1}. ${item(li)}`).join("\n")];
      case "ul": return [tags(kids).map((li) => `- ${item(li)}`).join("\n")];
      case "header": return [`# ${inline(kids[0]!)}`, `*${inline(kids[1]!)}*`];
    }
    if (cls(n, "english") && both) return [quote(blocks(kids).join("\n\n"))];
    if (cls(n, "instruction")) return blocks(kids).map((b) => (both ? quote(`*${b}*`) : b));
    if (cls(n, "note")) {
      const [first, ...rest] = blocks(kids);
      return [`**${n.attributes["data-label"]}.** ${first ?? ""}`, ...rest];
    }
    if (cls(n, "passage") && n.attributes["data-speaker"]) {
      const [first, ...rest] = blocks(kids);
      return [`**${n.attributes["data-speaker"]}:** ${first ?? ""}`, ...rest];
    }
    return blocks(kids);
  }

  return chapters.map(({ chapter, tree }, i) => ({
    slug: chapter.slug,
    file: chapter.file,
    markdown: blocks(tree.children).join("\n\n") + "\n",
  }));
}
