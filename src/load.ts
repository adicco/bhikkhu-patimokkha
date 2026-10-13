import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Markdoc, { Tag, type RenderableTreeNode } from "@markdoc/markdoc";
import { markdocConfig } from "./schema";
import type { Show } from "./options";
import type { Occasion } from "./occasion";

export const CONTENT_DIR = join(import.meta.dir, "..", "content");

export interface Chapter {
  file: string;
  slug: string;
  title: string;
  kind?: string;
  ast: ReturnType<typeof Markdoc.parse>;
}

function frontmatter(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of (raw ?? "").split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) out[m[1]!] = m[2]!.replace(/^"(.*)"$/, "$1");
  }
  return out;
}

export function loadChapters(dir = CONTENT_DIR): Chapter[] {
  return readdirSync(dir)
    .filter((f) => /^\d\d-.*\.md$/.test(f))
    .sort()
    .map((file) => {
      const source = readFileSync(join(dir, file), "utf8").normalize("NFC");
      const ast = Markdoc.parse(source, file);
      const fm = frontmatter(ast.attributes.frontmatter);
      return { file, slug: fm.slug ?? file, title: fm.title ?? file, kind: fm.kind, ast };
    });
}

/** Typographic quotes: the sources use ASCII ' and " for easy editing. */
export function smartQuotes(s: string, prev = " "): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    const before = i === 0 ? prev : s[i - 1]!;
    const opening = /[\s(\[—“‘]/.test(before);
    if (c === '"') out += opening ? "“" : "”";
    else if (c === "'") out += opening ? "‘" : "’";
    else out += c;
  }
  return out;
}

const BLOCKS = new Set(["p", "li", "div", "section", "header", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th"]);

function typography(node: RenderableTreeNode, state = { prev: " " }): RenderableTreeNode {
  if (typeof node === "string") {
    const out = smartQuotes(node, state.prev);
    if (node.length) state.prev = node[node.length - 1]!;
    return out;
  }
  if (Array.isArray(node)) return node.map((n) => typography(n, state)) as any;
  if (Tag.isTag(node)) {
    // A quote at the start of a block opens, whatever ended the block before it.
    if (BLOCKS.has(node.name)) state.prev = " ";
    node.children = node.children.map((c) => typography(c, state));
    for (const k of ["title"]) if (typeof node.attributes[k] === "string") node.attributes[k] = smartQuotes(node.attributes[k]);
  }
  return node;
}

export interface Rendered {
  chapter: Chapter;
  tree: Tag;
}

/**
 * `occasion` fills in the readings that change from one uposatha to the next; `only` keeps just
 * the chapters with these slugs (in book order).
 */
export function render(chapters: Chapter[], show: Show, occasion: Occasion = {}, only?: string[]): Rendered[] {
  const config = markdocConfig(show, occasion);
  return chapters
    .filter((c) => show.notes || c.kind !== "notes")
    .filter((c) => !only || only.includes(c.slug))
    .map((chapter) => {
      const tree = typography(Markdoc.transform(chapter.ast, config)) as Tag;
      return { chapter, tree };
    })
    .filter((r) => r.tree.children.some(Boolean));
}

export function validate(chapters: Chapter[]) {
  const config = markdocConfig({ pali: true, english: true, instructions: true, notes: true, corrections: false });
  return chapters.flatMap((c) =>
    Markdoc.validate(c.ast, config).map((e) => ({ file: c.file, line: e.lines?.[0], ...e.error })),
  );
}

/**
 * Every distinct Pāli word in the book (lowercase, split at hyphens and apostrophes), so that
 * writers can keep the English rules for breaking words off the Pāli quoted in English text.
 */
export function paliWords(chapters: Chapter[]): Set<string> {
  const words = new Set<string>();
  // Only text marked as Pāli: the notes chapter mixes English prose with Pāli readings.
  const visit = (n: RenderableTreeNode, pali: boolean) => {
    if (typeof n === "string") {
      if (pali) for (const w of n.toLowerCase().split(/[^\p{L}]+/u)) if (w) words.add(w);
    } else if (Tag.isTag(n) && n.attributes.lang !== "en") {
      const inner = pali || n.attributes.lang === "pi" || /\bnumbers\b/.test(n.attributes.class ?? "");
      n.children.forEach((c) => visit(c, inner));
    }
  };
  const show = { pali: true, english: false, instructions: false, notes: true, corrections: true };
  for (const { tree } of render(chapters, show)) visit(tree, false);
  return words;
}
