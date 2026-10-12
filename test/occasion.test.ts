import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashedName } from "../src/artifacts";
import { uposathaDays } from "../src/calendar";
import { loadChapters, render } from "../src/load";
import { NUMBERS, occasionErrors, reading, SEASON_TABLES, SLOT_NAMES, type Occasion } from "../src/occasion";
import { showFor } from "../src/options";
import { toMarkdown } from "../src/writers/markdown";
import { toHtml } from "../src/writers/html";

const chapters = loadChapters();
const md = (o: Occasion, only: string[], lang: "both" | "pali" | "english" = "both") => {
  const show = showFor(lang);
  return toMarkdown(render(chapters, show, o, only), show).map((c) => c.markdown).join("\n");
};
const source = (file: string) => readFileSync(join(import.meta.dir, "..", "content", file), "utf8").normalize("NFC");
/** Markdoc source → its text, as a reader would see it. */
const plain = (s: string) => s.replace(/\{%[^%]*%\}/g, "").replace(/\\\n/g, " ").replace(/,\s+/g, ", ");

describe("occasion", () => {
  test("an empty occasion prints the book's readings", () => {
    const text = md({}, ["pubba-kicca", "nidana"]);
    expect(text).toContain("*hemantotu³*");
    expect(text).toContain("*aṭṭha uposathā⁴*");
    expect(text).toContain("*cattāro⁶*");
    expect(text).toContain("uposatho paṇṇaraso [cātuddaso],");
    expect(text).toContain("Suṇātu me bhante [āvuso] saṅgho.");
  });

  test("every substituted Pāli reading is printed in the book", () => {
    const notes = plain(source("02-pubba-kicca-notes.md")) + plain(source("15-pavarana.md"));
    const occasions: Occasion[] = [
      { time: "night" }, { helpers: "samaneras" }, { helpers: "aramikas" },
      ...(["hemanta", "gimha", "vassana"] as const).flatMap((season) => [false, true].flatMap((adhika) =>
        SEASON_TABLES[(adhika ? 2 : 0) + (season === "vassana" ? 1 : 0)]!.entries
          .map((e, i) => (e ? { season, adhika, fortnight: i + 1 } : undefined)).filter(Boolean) as Occasion[])),
      ...[...NUMBERS].flatMap(([n, forms]) => forms.map((_, i) => ({ bhikkhus: n, form: i + 1 }))),
    ];
    let checked = 0;
    for (const o of occasions) for (const name of SLOT_NAMES) {
      const r = reading(name, "pi", o);
      if (!r.source) continue;
      // Note 4's "sattā" is printed with its {% sic %}; compare the book's reading.
      const text = plain(r.source.replace(/\{% sic correction="[^"]*" %\}([^{]*)\{% \/sic %\}/g, "$1"));
      expect(notes).toContain(text);
      checked++;
    }
    expect(checked).toBeGreaterThan(150);
  });

  test("note 5's tables are read with the Pavāraṇā in its place", () => {
    expect(SEASON_TABLES.map((t) => t.entries.length)).toEqual([8, 8, 10, 10]);
    expect(SEASON_TABLES.map((t) => t.entries.indexOf(null) + 1)).toEqual([0, 6, 0, 8]);
    expect(NUMBERS.get(12)).toEqual(["dvādasa", "bārasa"]);
  });

  test("a full uposatha occasion", () => {
    const o: Occasion = { time: "night", helpers: "samaneras", season: "vassana", fortnight: 3, bhikkhus: 12, form: 2, day: "fourteenth", address: "avuso" };
    expect(occasionErrors(o)).toEqual([]);
    const text = md(o, ["pubba-kicca", "nidana"]);
    expect(text).toContain("*Tattha purimāni cattāri¹* bhikkhūnaṁ vattaṁ jānantehi *sāmaṇerehi-pi bhikkhūhi-pi²*");
    expect(text).toContain("The first four have been done by novices and bhikkhus");
    expect(text).toContain("Ayaṁ *vassānotu³*. Asmiñ-ca utumhi *satta ca uposathā ekā ca pavāraṇā⁴*.");
    expect(text).toContain("*dve uposathā atikkantā,\\\ncattāro ca uposathā ekā ca pavāraṇā avasiṭṭhā⁵*.");
    expect(text).toContain("uposath’agge *bārasa⁶* bhikkhū");
    expect(text).toContain("Hall *12* bhikkhus".replace("Hall", "hall"));
    expect(text).toContain("yathājja uposatho cātuddaso,");
    expect(text).toContain("Suṇātu me āvuso saṅgho. Ajj’uposatho cātuddaso.");
    expect(text).toContain("Friends, may the Saṅgha listen to me. Today is the Uposatha of the fourteenth.");
  });

  test("corrections apply inside substituted readings too", () => {
    const show = showFor("pali", { corrections: true });
    const text = toMarkdown(render(chapters, show, { season: "vassana" }, ["pubba-kicca"]), show)[0]!.markdown;
    expect(text).toContain("*satta ca uposathā ekā ca pavāraṇā*"); // Pāli-only: no note references
  });

  test("a Pavāraṇā occasion", () => {
    const text = md({ adhika: true, bhikkhus: 23, day: "harmony", statements: "two" }, ["pavarana"], "pali");
    expect(text).toContain("Imasmiñ-ca utumhi adhikamāsa-vasena nava ca uposathā ekā ca pavāraṇā. Iminā pakkhena—");
    expect(text).toContain("satta uposathā atikkantā,\\\n*dve uposathā avasiṭṭhā*");
    expect(text).toContain("PAVĀRAṆ’AGGE tevīsati bhikkhū");
    expect(text).toContain("Ajja pavāraṇā sāmaggī. Yadi saṅghassa pattakallaṁ, saṅgho dve-vācikaṁ pavāreyya.");
  });

  test("English the book doesn't give is left as printed and marked", () => {
    const show = showFor("both");
    const html = toHtml(render(chapters, show, { season: "gimha", fortnight: 4 }, ["pubba-kicca"]), show, { title: "t" });
    expect(html).toMatch(/<span class="slot unglossed" data-slot="remaining" data-set="">.*seven.* Uposathas remain<\/span>/);
    expect(html).not.toContain("undefined\"");
  });

  test("impossible occasions are refused", () => {
    expect(occasionErrors({ season: "vassana", fortnight: 6 })).toEqual(["uposatha 6 during a normal rainy season is the Pavāraṇā"]);
    expect(occasionErrors({ fortnight: 9 })).toHaveLength(1);
    expect(occasionErrors({ bhikkhus: 115 })).toHaveLength(1);
    expect(occasionErrors({ bhikkhus: 12, form: 3 })).toHaveLength(1);
    expect(occasionErrors({ season: "monsoon" as any })).toHaveLength(1);
  });
});

describe("calendar", () => {
  const days = uposathaDays();
  test("reads the Mahānikāya calendar", () => {
    expect(days.find((d) => d.date === "2026-10-26")).toMatchObject({ season: "vassana", fortnight: 6, pavarana: true, day: "fifteenth" });
    expect(days.find((d) => d.date === "2026-11-09")).toMatchObject({ fortnight: 7, day: "fourteenth", pavarana: false });
    // In this reckoning the extra month always falls in the hot season.
    expect(days.filter((d) => d.adhika).every((d) => d.season === "gimha")).toBe(true);
  });
  test("every calendar day is an occasion the book can print", () => {
    for (const d of days) {
      if (d.pavarana) continue;
      expect(occasionErrors({ season: d.season, adhika: d.adhika, fortnight: d.fortnight, day: d.day })).toEqual([]);
    }
  });
});

test("release file names carry the hash before the extension", () => {
  expect(hashedName("/x/Bhikkhu-Patimokkha.Pali.A4.pdf", "0123456789")).toBe("Bhikkhu-Patimokkha.Pali.A4.0123456789.pdf");
  expect(hashedName("Bhikkhu-Patimokkha.Pali.Markdown.zip", "abc")).toBe("Bhikkhu-Patimokkha.Pali.Markdown.abc.zip");
});
