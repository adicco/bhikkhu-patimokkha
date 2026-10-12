/**
 * Real builds from the form: each format, paper, layout and language, downloaded and opened.
 * Needs what the build needs (LuaLaTeX, pandoc, zip) plus pdftotext/pdfinfo and unzip.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Browser, Page } from "playwright-core";
import { buildFromForm, change, launch, open, startSite, type Site } from "./harness";

let site: Site;
let browser: Browser;
beforeAll(async () => {
  const missing = ["lualatex", "pandoc", "zip", "unzip", "pdftotext", "pdfinfo"].filter((t) => !Bun.which(t));
  if (missing.length) throw new Error(`the build tests need: ${missing.join(", ")}`);
  [site, browser] = await Promise.all([startSite(), launch()]);
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await site?.stop();
});

const radio = (name: string, value: string) => `input[name="${name}"][value="${value}"]`;
const UPOSATHA = "2026-11-09"; // the 7th uposatha of the rains, a 14th

async function withPage(fn: (page: Page) => Promise<void>) {
  const o = await open(browser, site);
  try {
    await fn(o.page);
    expect(o.errors).toEqual([]);
  } finally {
    await o.close();
  }
}

/** Steps: [selector, value] for selects, a radio as [name, value], a chapter alone as ["solo", title]. */
async function configure(page: Page, steps: [string, string][]) {
  for (const [what, value] of steps) {
    await change(page, () =>
      what === "solo" ? page.click(`button.solo:text-is("${value}")`)
      : what === "chapter" ? page.check(`input[name="chapter"][value="${value}"]`)
      : what === "uncheck" ? page.uncheck(`input[name="${value}"]`)
      : what === "check" ? page.check(`input[name="${value}"]`)
      : what.startsWith("select") || what === "#date" ? page.selectOption(what, value)
      : page.check(radio(what, value)));
  }
}

const sh = (cmd: string[]) => {
  const p = Bun.spawnSync(cmd);
  if (p.exitCode !== 0) throw new Error(`${cmd[0]} failed: ${p.stderr.toString()}`);
  return p.stdout.toString().normalize("NFC");
};
/** Text with whitespace and hyphens removed, so line breaks and hyphenation don't matter. */
const squash = (s: string) => s.normalize("NFC").replace(/[\s\-­]+/g, "");
const pdfText = (path: string) => squash(sh(["pdftotext", path, "-"]));
const pdfInfo = (path: string) => {
  const info = sh(["pdfinfo", path]);
  const [, w, h] = info.match(/Page size:\s+([\d.]+) x ([\d.]+)/)!;
  return { pages: Number(info.match(/Pages:\s+(\d+)/)![1]), width: Math.round(Number(w)), height: Math.round(Number(h)) };
};
const A4 = { width: 595, height: 842 };
const A5 = { width: 420, height: 595 };
const unzipList = (path: string) => sh(["unzip", "-Z1", path]).trim().split("\n").sort();
/** The text of the matching files in a zip, tags removed. */
const unzipText = (path: string, pattern: string) => squash(sh(["unzip", "-p", path, pattern]).replace(/<[^>]+>/g, ""));

describe("PDF", () => {
  test("an A5 copy of the Preliminary Duties for one uposatha", () => withPage(async (page) => {
    await configure(page, [
      ["#date", UPOSATHA], ["solo", "Pubba-kicca"], ["time", "night"], ["helpers", "samaneras"],
      ['select[name="bhikkhus"]', "12:2"],
    ]);
    const t0 = performance.now();
    const { name, path, status } = await buildFromForm(page);
    const first = performance.now() - t0;
    expect(name).toMatch(/^Bhikkhu-Patimokkha\.Pali-English\.custom\.A5\.[0-9a-f]{10}\.pdf$/);
    expect(status).toBe(`Built ${name}.`);
    expect(pdfInfo(path)).toMatchObject(A5);
    const text = pdfText(path);
    for (const s of [
      "Tattha purimāni cattāri bhikkhūnaṁ vattaṁ jānantehi sāmaṇerehi-pi bhikkhūhi-pi",
      "The first four have been done by novices and bhikkhus",
      "Ayaṁ vassānotu", "sattā ca uposathā ekā ca pavāraṇā",
      "pañca ca uposathā ekā ca pavāraṇā atikkantā, eko uposatho avasiṭṭho", // note 5, rainy season, seventh
      "uposath’agge bārasa bhikkhū", "12 bhikkhus have gathered",
      "yathājja uposatho cātuddaso,", "as today is the fourteenth",
    ]) expect(text).toContain(squash(s));
    for (const s of ["padīpa-kiccaṁ idāni", "Nidāna", "Preliminary Duties: Notes"]) expect(text).not.toContain(squash(s));

    // The same request again comes from the cache: same file, at once.
    const t1 = performance.now();
    const again = await buildFromForm(page);
    expect(again.name).toBe(name);
    expect(performance.now() - t1).toBeLessThan(Math.max(1500, first / 3));
  }));

  test("A4 with the English beside the Pāli", () => withPage(async (page) => {
    await configure(page, [["#date", UPOSATHA], ["solo", "Pubba-kicca"], ["paper", "a4"], ["columns", "1"]]);
    const { name, path } = await buildFromForm(page);
    expect(name).toMatch(/\.custom\.A4\.[0-9a-f]{10}\.pdf$/);
    expect(pdfInfo(path)).toMatchObject(A4);
    // Laid out side by side, the counting passage and its English start on the same line.
    const layout = sh(["pdftotext", "-layout", path, "-"]);
    expect(layout.split("\n").some((l) => l.includes("Bhikkhu-gaṇanā") && l.includes("Bhikkhu-counting"))).toBe(true);
  }));

  test("a Pāli booklet in sewn sections, at 13 pt", () => withPage(async (page) => {
    await configure(page, [
      ["#date", UPOSATHA], ["lang", "pali"], ["paper", "booklet"], ['select[name="size"]', "13"],
      ['select[name="signature"]', "16"], ["solo", "Pubba-kicca"], ["chapter", "nidana"], ["address", "avuso"],
    ]);
    const { name, path } = await buildFromForm(page);
    expect(name).toMatch(/^Bhikkhu-Patimokkha\.Pali\.custom\.A5-booklet\.[0-9a-f]{10}\.pdf$/);
    const info = pdfInfo(path);
    expect({ width: info.width, height: info.height }).toEqual({ width: A4.height, height: A4.width }); // A4 landscape
    expect(info.pages % 2).toBe(0);
    const text = pdfText(path);
    expect(text).toContain(squash("Suṇātu me āvuso saṅgho. Ajj’uposatho cātuddaso."));
    expect(text).not.toContain(squash("Before doing the Uposatha"));
  }));

  test("the type size changes the setting", () => withPage(async (page) => {
    await configure(page, [["#date", UPOSATHA], ["lang", "pali"], ["solo", "Pācittiya"], ['select[name="size"]', "10"]]);
    const small = pdfInfo((await buildFromForm(page)).path).pages;
    await configure(page, [['select[name="size"]', "14"]]);
    const large = pdfInfo((await buildFromForm(page)).path).pages;
    expect(large).toBeGreaterThan(small);
  }));
});

describe("EPUB, HTML and Markdown", () => {
  test("an EPUB of the Pavāraṇā", () => withPage(async (page) => {
    await configure(page, [
      ["target", "epub"], ["check", "adhika"], ['select[name="bhikkhus"]', "23:1"],
      ["day", "harmony"], ["statements", "two"],
    ]);
    const { name, path } = await buildFromForm(page);
    expect(name).toMatch(/^Bhikkhu-Patimokkha\.Pali-English\.custom\.[0-9a-f]{10}\.epub$/);
    const files = unzipList(path);
    expect(files).toContain("mimetype");
    expect(files.some((f) => /fonts\/GentiumPlus-Regular\.ttf$/.test(f))).toBe(true);
    const text = unzipText(path, "EPUB/text/*.xhtml");
    for (const s of [
      "adhikamāsa-vasena nava ca uposathā ekā ca pavāraṇā", "satta uposathā atikkantā",
      "tevīsati bhikkhū", "Ajja pavāraṇā sāmaggī", "saṅgho dve-vācikaṁ pavāreyya",
    ]) expect(text).toContain(squash(s));
    expect(text).not.toContain(squash("Pārājika"));
  }));

  test("HTML of a small-group uposatha, with and without the English instructions", () => withPage(async (page) => {
    await configure(page, [["target", "html"], ["ceremony", "group"], ["address", "avuso"], ["day", "fourteenth"]]);
    const first = await buildFromForm(page);
    expect(first.name).toMatch(/^Bhikkhu-Patimokkha\.Pali-English\.custom\.[0-9a-f]{10}\.html$/);
    const html = await Bun.file(first.path).text();
    expect(html).toContain("Suṇantu me <span class=\"slot\" data-slot=\"address\" data-set=\"\">āvuso</span> āyasmantā");
    expect(html).toContain("ajj’uposatho <span class=\"slot\" data-slot=\"day\" data-set=\"\">cātuddaso</span>");
    expect(html).toContain("In an assembly of only three bhikkhus");

    await configure(page, [["uncheck", "instructions"]]);
    const second = await buildFromForm(page);
    expect(second.name).not.toBe(first.name);
    const plain = await Bun.file(second.path).text();
    expect(plain).not.toContain("In an assembly of only three bhikkhus");
    expect(plain).toContain("cātuddaso");
  }));

  test("Markdown of chosen chapters, zipped", () => withPage(async (page) => {
    await configure(page, [["#date", UPOSATHA], ["target", "md"], ["solo", "Pubba-kicca"], ["chapter", "nidana"], ["season", "gimha"], ["select[name=\"fortnight\"]", "2"]]);
    const { name, path } = await buildFromForm(page);
    expect(name).toMatch(/^Bhikkhu-Patimokkha\.Pali-English\.custom\.Markdown\.[0-9a-f]{10}\.zip$/);
    expect(unzipList(path)).toEqual(["Bhikkhu-Patimokkha.Pali-English.md", "md/01-pubba-kicca.md", "md/03-nidana.md"]);
    const md = sh(["unzip", "-p", path, "md/01-pubba-kicca.md"]);
    expect(md).toContain("Ayaṁ *gimhotu*.");
    expect(md).toContain("eko uposatho sampatto,\\\n*eko uposatho atikkanto,\\\ncha uposathā avasiṭṭhā*.");
    expect(sh(["unzip", "-p", path, "md/03-nidana.md"])).toContain("Ajj’uposatho cātuddaso.");
  }));

  test("English only", () => withPage(async (page) => {
    await configure(page, [["#date", UPOSATHA], ["lang", "english"], ["target", "html"], ["solo", "Nidāna"]]);
    const { name, path } = await buildFromForm(page);
    expect(name).toMatch(/^Bhikkhu-Patimokkha\.English\.custom\.[0-9a-f]{10}\.html$/);
    const html = await Bun.file(path).text();
    expect(html).toContain("Today is the Uposatha of the <span class=\"slot\" data-slot=\"day\" data-set=\"\">fourteenth</span>");
    expect(html).not.toContain("Ajj’uposatho");
  }));
});
