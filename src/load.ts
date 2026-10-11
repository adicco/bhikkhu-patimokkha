import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Markdoc, { Tag, type RenderableTreeNode } from "@markdoc/markdoc";
import { markdocConfig } from "./schema";
import type { Show } from "./options";

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

function typography(node: RenderableTreeNode, state = { prev: " " }): RenderableTreeNode {
  if (typeof node === "string") {
    const out = smartQuotes(node, state.prev);
    if (node.length) state.prev = node[node.length - 1]!;
    return out;
  }
  if (Array.isArray(node)) return node.map((n) => typography(n, state)) as any;
  if (Tag.isTag(node)) {
    node.children = node.children.map((c) => typography(c, state));
    for (const k of ["title"]) if (typeof node.attributes[k] === "string") node.attributes[k] = smartQuotes(node.attributes[k]);
  }
  return node;
}

export interface Rendered {
  chapter: Chapter;
  tree: Tag;
}

export function render(chapters: Chapter[], show: Show): Rendered[] {
  const config = markdocConfig(show);
  return chapters
    .filter((c) => show.notes || c.kind !== "notes")
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
