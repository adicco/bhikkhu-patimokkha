import { describe, expect, test } from "bun:test";
import { loadChapters, render, validate } from "../src/load";
import { showFor } from "../src/options";
import { toMarkdown } from "../src/writers/markdown";

const chapters = loadChapters();

describe("content", () => {
  test("validates against the Markdoc schema", () => {
    expect(validate(chapters)).toEqual([]);
  });

  test("has every rule, numbered in sequence", () => {
    const expected = { parajika: 4, sanghadisesa: 13, aniyata: 2, nissaggiya: 30, pacittiya: 92, patidesaniya: 4, sekhiya: 75 };
    for (const [cls, count] of Object.entries(expected)) {
      const ns = chapters.flatMap((c) => [...c.ast.walk()])
        .filter((n) => n.type === "tag" && n.tag === "rule" && n.attributes.class === cls)
        .map((n) => n.attributes.n);
      expect(ns).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    }
  });

  test("sources are NFC and use ṁ, not ṃ", () => {
    for (const c of chapters) {
      const src = JSON.stringify(c.ast);
      expect(src).not.toContain("ṃ");
    }
  });
});

describe("builds", () => {
  const md = (lang: "pali" | "english" | "both", extra = {}) =>
    toMarkdown(render(chapters, showFor(lang, extra)), showFor(lang, extra)).map((c) => c.markdown).join("\n");

  test("Pāli-only build contains no English translation", () => {
    const pali = md("pali");
    expect(pali).toContain("Sampajāna-musāvāde pācittiyaṁ.");
    expect(pali).not.toContain("A deliberate lie is to be confessed.");
    expect(pali).not.toContain("NOTES");
  });

  test("English-only build contains no Pāli rule text", () => {
    const en = md("english");
    expect(en).toContain("A deliberate lie is to be confessed.");
    expect(en).not.toContain("Sampajāna-musāvāde pācittiyaṁ.");
  });

  test("bilingual build has both, with English quoted", () => {
    const both = md("both");
    expect(both).toContain("Sampajāna-musāvāde pācittiyaṁ.");
    expect(both).toContain("> **1.** A deliberate lie is to be confessed.");
  });

  test("book readings are kept unless corrections are requested", () => {
    expect(md("pali")).toContain("muḷho’si");
    expect(md("pali", { corrections: true })).toContain("mūḷho’si");
  });
});
