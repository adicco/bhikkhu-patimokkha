import Markdoc, { Tag, type Config, type Node, type RenderableTreeNode, type Schema } from "@markdoc/markdoc";
import type { Show } from "./options";
import { reading, type Lang, type Occasion } from "./occasion";

const show = (config: Config): Show => config.variables?.show as Show;
const occasion = (config: Config): Occasion => (config.variables?.occasion ?? {}) as Occasion;
/** The language of the block being transformed (set by the pali/english/instruction tags). */
const langOf = (config: Config): Lang => (config.variables?.lang ?? "en") as Lang;

const children = (node: Node, config: Config) => node.transformChildren(config);

/** Block that is only rendered when `flag` is on. */
const gated = (flag: keyof Show, name: string, cls: string, extra: Record<string, unknown> = {}): Schema => ({
  transform(node, config) {
    if (!show(config)[flag]) return null;
    const inner = extra.lang ? { ...config, variables: { ...config.variables, lang: extra.lang } } : config;
    return new Tag(name, { class: cls, ...extra }, children(node, inner));
  },
});

/** Inline Markdoc source (a reading from the notes) transformed with the current config. */
function inlineSource(source: string, config: Config): RenderableTreeNode[] {
  const tree = Markdoc.transform(Markdoc.parse(source), config);
  const p = Tag.isTag(tree) ? tree.children.find((c) => Tag.isTag(c) && c.name === "p") : undefined;
  return Tag.isTag(p) ? p.children : [];
}

/** Readings named after the occasion's choice (bhante="…" avuso="…"), for the bracketed alternatives. */
const SLOT_FIELDS: Record<string, keyof Occasion> = { day: "day", address: "address", statements: "statements" };

/** Wraps a pair of strings (pali / english attributes) in language spans. */
function pair(attrs: Record<string, any>, config: Config): RenderableTreeNode[] {
  const s = show(config);
  const out: RenderableTreeNode[] = [];
  if (s.pali && attrs.pali) out.push(new Tag("span", { class: "pali", lang: "pi" }, [attrs.pali]));
  if (s.english && attrs.english) out.push(new Tag("span", { class: "english", lang: "en" }, [attrs.english]));
  return out;
}

/** Prefix "n. " to the first paragraph of each language block in a rule. */
function numberRule(nodes: RenderableTreeNode[], n: number) {
  for (const lang of nodes) {
    if (!Tag.isTag(lang)) continue;
    const first = lang.children.find((c) => Tag.isTag(c) && c.name === "p");
    if (Tag.isTag(first)) first.children.unshift(new Tag("span", { class: "num" }, [`${n}.`]), " ");
  }
}

const pairAttrs = {
  pali: { type: String },
  english: { type: String },
};

export const tags: Record<string, Schema> = {
  pali: gated("pali", "div", "pali", { lang: "pi" }),
  english: gated("english", "div", "english", { lang: "en" }),
  instruction: gated("instructions", "div", "instruction", { lang: "en" }),

  passage: {
    attributes: {
      speaker: { type: String },
      align: { type: String, matches: ["center"] },
      kind: { type: String },
      id: { type: String },
    },
    transform(node, config) {
      const a = node.transformAttributes(config);
      const kids = children(node, config).filter(Boolean);
      if (!kids.length) return null;
      return new Tag("div", {
        class: ["passage", a.align && `align-${a.align}`, a.kind].filter(Boolean).join(" "),
        ...(a.id && { id: a.id }),
        ...(a.speaker && { "data-speaker": a.speaker }),
      }, kids);
    },
  },

  rule: {
    attributes: {
      class: { type: String, required: true, matches: ["parajika", "sanghadisesa", "aniyata", "nissaggiya", "pacittiya", "patidesaniya", "sekhiya"] },
      n: { type: Number, required: true },
    },
    transform(node, config) {
      const a = node.transformAttributes(config);
      const kids = children(node, config).filter(Boolean);
      numberRule(kids, a.n);
      return new Tag("div", { class: `passage rule ${a.class}`, id: `${a.class}-${a.n}`, "data-n": a.n }, kids);
    },
  },

  heading: {
    selfClosing: true,
    attributes: { ...pairAttrs, level: { type: Number, default: 2 }, hidden: { type: Boolean } },
    transform(node, config) {
      const a = node.transformAttributes(config);
      if (a.hidden) return null;
      const s = show(config);
      let parts = pair(a, config);
      // A heading identical in both languages is shown once.
      if (s.pali && s.english && a.pali && a.pali === a.english) parts = parts.slice(0, 1);
      if (!parts.length) return null;
      return new Tag(`h${a.level}`, { class: "heading" }, parts);
    },
  },

  title: {
    selfClosing: true,
    attributes: pairAttrs,
    transform(node, config) {
      const a = node.transformAttributes(config);
      const s = show(config);
      // The book's subtitle is "Pāli – English"; single-language builds say which one they are.
      const subtitle = s.pali && s.english ? a.english : s.pali ? "Pāli" : "English";
      return new Tag("header", { class: "title" }, [
        new Tag("h1", {}, [a.pali]),
        new Tag("p", { class: "subtitle" }, [subtitle]),
      ]);
    },
  },

  response: {
    selfClosing: true,
    attributes: pairAttrs,
    transform(node, config) {
      const parts = pair(node.transformAttributes(config), config);
      return parts.length ? new Tag("p", { class: "response" }, parts) : null;
    },
  },

  rubric: {
    selfClosing: true,
    attributes: { ...pairAttrs, inline: { type: Boolean } },
    transform(node, config) {
      const a = node.transformAttributes(config);
      const parts = pair(a, config);
      if (!parts.length) return null;
      return new Tag(a.inline ? "span" : "p", { class: "rubric" }, parts);
    },
  },

  vagga: {
    selfClosing: true,
    attributes: pairAttrs,
    transform(node, config) {
      const parts = pair(node.transformAttributes(config), config);
      return parts.length ? new Tag("p", { class: "vagga" }, parts) : null;
    },
  },

  lines: {
    attributes: { indent: { type: Boolean } },
    transform(node, config) {
      const a = node.transformAttributes(config);
      return new Tag("div", { class: a.indent ? "lines indented" : "lines" }, children(node, config));
    },
  },
  stanza: { transform: (node, config) => new Tag("div", { class: "stanza" }, children(node, config)) },
  list: { transform: (node, config) => new Tag("div", { class: "numbered" }, children(node, config)) },
  call: { inline: true, transform: (node, config) => new Tag("span", { class: "call" }, children(node, config)) },
  lead: { inline: true, transform: (node, config) => new Tag("span", { class: "lead" }, children(node, config)) },
  indent: { inline: true, selfClosing: true, transform: () => new Tag("span", { class: "indent" }, []) },
  changed: { inline: true, transform: (node, config) => new Tag("span", { class: "changed" }, children(node, config)) },

  var: {
    inline: true,
    attributes: { note: { type: String } },
    transform(node, config) {
      const a = node.transformAttributes(config);
      const kids = children(node, config);
      if (a.note !== undefined && show(config).notes) {
        kids.push(new Tag("sup", { class: "noteref" }, [String(a.note).replace(/^\D+/, "")]));
      }
      return new Tag("span", { class: "var", "data-note": a.note }, kids);
    },
  },

  sic: {
    inline: true,
    attributes: { correction: { type: String, required: true } },
    transform(node, config) {
      const a = node.transformAttributes(config);
      // Corrected, the reading is simply the text; printed as the book has it, it's marked.
      if (show(config).corrections) return a.correction;
      return new Tag("span", { class: "sic", title: `read: ${a.correction}` }, children(node, config));
    },
  },

  note: {
    attributes: { id: { type: String, required: true } },
    transform(node, config) {
      if (!show(config).notes) return null;
      const a = node.transformAttributes(config);
      const label = String(a.id).replace(/^\D+/, "");
      return new Tag("div", { class: "note", id: `note-${a.id}`, "data-label": label }, children(node, config));
    },
  },

  "season-table": {
    attributes: { title: { type: String } },
    transform(node, config) {
      const a = node.transformAttributes(config);
      return new Tag("div", { class: "season-table" }, [new Tag("p", { class: "table-title" }, [a.title]), ...children(node, config)]);
    },
  },
  /**
   * Text that changes with the occasion (see src/occasion.ts). Unset, it prints as in the book.
   * English with no reading in the book for the chosen occasion keeps the printed English and is
   * marked "unglossed".
   */
  slot: {
    inline: true,
    attributes: Object.fromEntries(["name", "fifteenth", "fourteenth", "harmony", "bhante", "avuso", "three", "two", "one"]
      .map((k) => [k, { type: String, required: k === "name" }])),
    transform(node, config) {
      const a = node.transformAttributes(config);
      const o = occasion(config);
      const field = SLOT_FIELDS[a.name];
      let r;
      if (field) {
        const v = o[field] as string | undefined;
        r = { changed: v !== undefined, source: v !== undefined ? a[v] : undefined };
      } else {
        r = reading(a.name, langOf(config), o);
      }
      const unglossed = r.changed && r.source === undefined && langOf(config) === "en";
      const attrs: Record<string, string> = { class: unglossed ? "slot unglossed" : "slot", "data-slot": a.name };
      if (r.changed) attrs["data-set"] = "";
      return new Tag("span", attrs,
        r.source !== undefined ? inlineSource(r.source, config) : children(node, config));
    },
  },

  numbers: { transform: (node, config) => new Tag("div", { class: "numbers" }, children(node, config)) },
  // The source attribution is shown in every build, Pāli-only included.
  colophon: { render: "div", attributes: { class: { type: String, default: "colophon" }, lang: { type: String, default: "en" } } },
  signature: { transform: (node, config) => new Tag("div", { class: "signature" }, children(node, config)) },
  epigraph: {
    attributes: { source: { type: String } },
    transform(node, config) {
      const a = node.transformAttributes(config);
      return new Tag("div", { class: "epigraph" }, [...children(node, config), new Tag("p", { class: "source" }, [`—${a.source}`])]);
    },
  },
};

export function markdocConfig(s: Show, o: Occasion = {}): Config {
  return { tags, variables: { show: s, occasion: o } };
}

export { Markdoc };
