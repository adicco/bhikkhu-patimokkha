/**
 * The distribution page in a browser: downloads, the occasion form, the preview, chapters and
 * file options, and the server's API. Expected Pāli is typed from the book's notes, not taken
 * from src/occasion.ts, so a wrong substitution fails here.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Browser, Page } from "playwright-core";
import { uposathaDays } from "../src/calendar";
import { change, checkedChapters, formState, launch, open, previewText, shown, startSite, TODAY, type Opened, type Site } from "./harness";

let site: Site;
let browser: Browser;
beforeAll(async () => {
  [site, browser] = await Promise.all([startSite(), launch()]);
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await site?.stop();
});

/** A fresh page per test; fails the test on any script error. */
async function withPage(fn: (page: Page, o: Opened) => Promise<void>, opts: Parameters<typeof open>[2] = {}) {
  const o = await open(browser, site, opts);
  try {
    await fn(o.page, o);
    expect(o.errors).toEqual([]);
  } finally {
    await o.close();
  }
}

const radio = (name: string, value: string) => `input[name="${name}"][value="${value}"]`;
/** Pick an uposatha that isn't the Pavāraṇā: 9 November 2026, the 7th of the rains, a 14th. */
const UPOSATHA = "2026-11-09";

describe("downloads", () => {
  test("every language × format links to its hashed file", () => withPage(async (page) => {
    const rows = page.locator("table.downloads tbody tr");
    expect(await rows.count()).toBe(3);
    expect(await page.locator("table.downloads thead th").allTextContents())
      .toEqual(["A4 PDF", "A5 PDF", "A5 booklet", "EPUB", "HTML", "Markdown"]);
    const hrefs = await page.$$eval("table.downloads a", (as) => as.map((a) => a.getAttribute("href")!));
    expect(hrefs.sort()).toEqual(site.manifest.files.map((f) => f.file).sort());
    for (const href of hrefs) {
      expect(href).toMatch(/^files\/bhikkhu-patimokkha\.v\d+\.\d+\.(pali\.eng|pali\.only|eng\.only)\.((a4|a5|a5-booklet)\.[0-9a-f]{10}\.pdf|[0-9a-f]{10}\.(epub|html)|md\.[0-9a-f]{10}\.zip)$/);
      const res = await page.request.get(site.url + href);
      expect(res.status()).toBe(200);
      expect(res.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
      expect(res.headers()["content-disposition"]).toBe("attachment");
      const entry = site.manifest.files.find((f) => f.file === href)!;
      expect(new Bun.CryptoHasher("sha256").update(await res.body()).digest("hex")).toBe(entry.sha256);
    }
    // Each link says what it is to a screen reader.
    expect(await page.locator("table.downloads a").first().getAttribute("aria-label")).toMatch(/^Pāli and English, A4 PDF, \d+ KB$/);
  }));

  test("the index itself is never cached, and the page doesn't offer corrections", () => withPage(async (page) => {
    const res = await page.request.get(site.url);
    expect(res.headers()["cache-control"]).toBe("no-cache");
    expect(await page.locator('input[name="corrections"]').count()).toBe(0);
    expect(await page.getByText(/correction|misprint/i).count()).toBe(0);
  }));
});

describe("the date", () => {
  test("starts at the next observance: the Pavāraṇā of 26 October 2026", () => withPage(async (page) => {
    const first = await page.$eval("#date option", (o) => (o as HTMLOptionElement).value);
    expect(first > TODAY).toBe(true);
    expect(await formState(page)).toMatchObject({ date: "2026-10-26", ceremony: "pavarana", season: "vassana", adhika: false, day: "fifteenth" });
    expect(await page.locator("#date option").first().textContent()).toBe("Monday, 26 October 2026, Pavāraṇā");
    expect(await page.locator("#date option").last().textContent()).toBe("Another day: set the details below");
  }));

  test("each date fills in the ceremony, season, extra month, uposatha and day from the calendar", () => withPage(async (page) => {
    const calendar = new Map(uposathaDays().map((d) => [d.date, d]));
    const dates = await page.$$eval("#date option", (os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    expect(dates.length).toBe(60);
    for (const date of dates) {
      await page.selectOption("#date", date);
      const d = calendar.get(date)!;
      const s = await formState(page);
      expect({ date, ceremony: s.ceremony, season: s.season, adhika: s.adhika, day: s.day })
        .toEqual({ date, ceremony: d.pavarana ? "pavarana" : "uposatha", season: d.season, adhika: d.adhika, day: d.day });
      if (!d.pavarana) expect(Number(s.fortnight)).toBe(d.fortnight);
    }
    // Spot checks against data/mahanikaya.csv itself.
    await page.selectOption("#date", "2026-11-09");
    expect(await formState(page)).toMatchObject({ ceremony: "uposatha", season: "vassana", fortnight: "7", day: "fourteenth" });
    await page.selectOption("#date", "2026-12-09");
    expect(await formState(page)).toMatchObject({ season: "hemanta", fortnight: "1", day: "fifteenth" });
  }));

  test("a hot season with an extra month has ten uposathas", () => withPage(async (page) => {
    await change(page, () => page.selectOption("#date", "2029-07-10"));
    expect(await formState(page)).toMatchObject({ season: "gimha", adhika: true, fortnight: "9", day: "fifteenth" });
    expect(await page.locator('select[name="fortnight"] option').count()).toBe(10);
    expect(await previewText(page)).toContain("Asmiñ-ca utumhi adhikamāsa-vasena dasa uposathā.");
  }, { date: "2029-03-01" }));

  test("a date keeps a small-group uposatha a small-group uposatha", () => withPage(async (page) => {
    await change(page, () => page.check(radio("ceremony", "group")));
    await page.selectOption("#date", UPOSATHA);
    expect(await formState(page)).toMatchObject({ ceremony: "group", day: "fourteenth" });
  }));

  test("changing a detail by hand leaves the calendar date", () => withPage(async (page) => {
    await change(page, () => page.selectOption("#date", UPOSATHA));
    await change(page, () => page.check(radio("day", "fifteenth")));
    expect((await formState(page)).date).toBe("");
    await change(page, () => page.selectOption("#date", UPOSATHA));
    expect(await formState(page)).toMatchObject({ date: UPOSATHA, day: "fourteenth" });
  }));
});

describe("ceremonies", () => {
  test("each ceremony asks only its own questions", () => withPage(async (page) => {
    const visible = async () => ({
      season: await shown(page, 'input[name="season"]'),
      adhika: await shown(page, 'input[name="adhika"]'),
      fortnight: await shown(page, 'select[name="fortnight"]'),
      harmony: await shown(page, radio("day", "harmony")),
      bhikkhus: await shown(page, 'select[name="bhikkhus"]'),
      address: await shown(page, 'input[name="address"]'),
      time: await shown(page, 'input[name="time"]'),
      helpers: await shown(page, 'input[name="helpers"]'),
      statements: await shown(page, 'input[name="statements"]'),
    });
    await change(page, () => page.check(radio("ceremony", "uposatha")));
    expect(await visible()).toEqual({ season: true, adhika: true, fortnight: true, harmony: false, bhikkhus: true, address: true, time: true, helpers: true, statements: false });
    await change(page, () => page.check(radio("ceremony", "pavarana")));
    expect(await visible()).toEqual({ season: false, adhika: true, fortnight: false, harmony: true, bhikkhus: true, address: false, time: false, helpers: false, statements: true });
    await change(page, () => page.check(radio("ceremony", "group")));
    expect(await visible()).toEqual({ season: false, adhika: false, fortnight: false, harmony: false, bhikkhus: false, address: true, time: false, helpers: false, statements: false });
  }));

  test("the harmony day belongs to the Pavāraṇā", () => withPage(async (page) => {
    await change(page, () => page.check(radio("day", "harmony")));
    await change(page, () => page.check(radio("ceremony", "uposatha")));
    expect((await formState(page)).day).toBe("fifteenth");
  }));
});

describe("note 5 and note 6", () => {
  test("the uposatha list follows the season, with the Pavāraṇā's place closed", () => withPage(async (page) => {
    await change(page, () => page.selectOption("#date", UPOSATHA));
    const options = () => page.$$eval('select[name="fortnight"] option', (os) => os.map((o) => `${o.textContent}${(o as HTMLOptionElement).disabled ? " (closed)" : ""}`));
    await change(page, () => page.check(radio("season", "hemanta")));
    expect(await options()).toEqual(["first of 8", "second of 8", "third of 8", "fourth of 8", "fifth of 8", "sixth of 8", "seventh of 8", "eighth of 8"]);
    await change(page, () => page.check(radio("season", "vassana")));
    expect((await options())[5]).toBe("sixth: the Pavāraṇā (closed)");
    await change(page, () => page.check('input[name="adhika"]'));
    expect(await options()).toHaveLength(10);
    expect((await options())[7]).toBe("eighth: the Pavāraṇā (closed)");
    await change(page, () => page.check(radio("season", "gimha")));
    expect((await options()).filter((o) => o.includes("closed"))).toEqual([]);
  }));

  test("the bhikkhu count offers each of the book's forms, from four (five for the Pavāraṇā)", () => withPage(async (page) => {
    const options = () => page.$$eval('select[name="bhikkhus"] option', (os) => os.map((o) => o.textContent));
    expect((await options())[0]).toBe("5, pañca");
    await change(page, () => page.selectOption("#date", UPOSATHA));
    const list = await options();
    expect(list[0]).toBe("4, cattāro");
    expect(list).toContain("12, dvādasa");
    expect(list).toContain("12, bārasa");
    expect(list).toContain("22, dvāvīsati");
    expect(list).toContain("22, bāvīsa");
    expect(list.at(-1)).toBe("500, pañca bhikkhu-satāni");
    expect((await formState(page)).bhikkhus).toBe("4:1");
  }));

  test("a count someone chose survives a change of ceremony", () => withPage(async (page) => {
    await change(page, () => page.selectOption("#date", UPOSATHA));
    await change(page, () => page.selectOption('select[name="bhikkhus"]', "23:1"));
    await change(page, () => page.check(radio("ceremony", "pavarana")));
    expect((await formState(page)).bhikkhus).toBe("23:1");
  }));
});

describe("the preview", () => {
  /** Set up an uposatha by hand and read what it will recite. */
  async function uposatha(page: Page, steps: [string, string][]) {
    await change(page, () => page.selectOption("#date", UPOSATHA));
    for (const [sel, value] of steps) {
      await change(page, () => (sel.startsWith("select") ? page.selectOption(sel, value) : page.check(value ? radio(sel, value) : sel)));
    }
    return previewText(page);
  }

  test("prints the book's own readings for an uposatha left as printed", () => withPage(async (page) => {
    const text = await uposatha(page, [["season", "hemanta"], ['select[name="fortnight"]', "1"], ["day", "fifteenth"]]);
    expect(text).toContain("Tattha purimesu catūsu kiccesu padīpa-kiccaṁ idāni suriy’ālokassa atthitāya n’atthi. Aparāni tīṇi bhikkhūnaṁ vattaṁ jānantehi bhikkhūhi katāni pariniṭṭhitāni honti.");
    expect(text).toContain("Ayaṁ hemantotu. Asmiñ-ca utumhi aṭṭha uposathā. Iminā pakkhena:\neko uposatho sampatto,\nsatta uposathā avasiṭṭhā.");
    expect(text).toContain("Imasmim-pana uposath’agge cattāro bhikkhū sannipatitā honti.");
    expect(text).toContain("yathājja uposatho paṇṇaraso,");
    expect(text).toContain("Suṇātu me bhante saṅgho. Ajj’uposatho paṇṇaraso.");
    expect(text).toContain("This is the winter, and in this season there are eight Uposathas.");
    expect(await page.isHidden("#unglossed-key")).toBe(true);
  }));

  test("note 1: at night", () => withPage(async (page) => {
    const text = await uposatha(page, [["time", "night"]]);
    expect(text).toContain("Tattha purimāni cattāri bhikkhūnaṁ vattaṁ jānantehi bhikkhūhi katāni");
    expect(text).not.toContain("padīpa-kiccaṁ");
    expect(text).toContain("The first four have been done by bhikkhus who know the bhikkhus’ duties.");
  }));

  test("note 2: who prepared the hall", () => withPage(async (page) => {
    let text = await uposatha(page, [["helpers", "samaneras"]]);
    expect(text).toContain("jānantehi sāmaṇerehi-pi bhikkhūhi-pi katāni");
    expect(text).toContain("done by novices and bhikkhus who know");
    await change(page, () => page.check(radio("helpers", "aramikas")));
    text = await previewText(page);
    expect(text).toContain("jānantehi ārāmikehi-pi bhikkhūhi-pi katāni");
    expect(text).toContain("done by monastery dwellers and bhikkhus who know");
  }));

  test("notes 3–5: seasons, extra months and which uposatha", () => withPage(async (page) => {
    let text = await uposatha(page, [["season", "gimha"], ['select[name="fortnight"]', "3"]]);
    expect(text).toContain("Ayaṁ gimhotu. Asmiñ-ca utumhi aṭṭha uposathā.");
    expect(text).toContain("eko uposatho sampatto,\ndve uposathā atikkantā,\npañca uposathā avasiṭṭhā.");
    expect(text).toContain("This is the summer");
    // The book gives no English for note 5's counts: the printed English stays, marked.
    expect(text).toContain("seven Uposathas remain.");
    expect(await page.isVisible("#unglossed-key")).toBe(true);
    expect(await page.locator('#preview .unglossed[data-slot="remaining"]').count()).toBe(1);

    await change(page, () => page.check(radio("season", "vassana")));
    text = await previewText(page);
    expect(text).toContain("Ayaṁ vassānotu. Asmiñ-ca utumhi satta ca uposathā ekā ca pavāraṇā."); // the book's "sattā", corrected
    expect(text).toContain("dve uposathā atikkantā,\ncattāro ca uposathā ekā ca pavāraṇā avasiṭṭhā.");
    expect(text).toContain("there are seven uposathas and one pavāraṇā");

    await change(page, () => page.check('input[name="adhika"]'));
    text = await previewText(page);
    expect(text).toContain("Asmiñ-ca utumhi adhikamāsa-vasena nava ca uposathā ekā ca pavāraṇā.");
    expect(text).toContain("dve uposathā atikkantā,\ncha ca uposathā ekā ca pavāraṇā avasiṭṭhā.");
    expect(text).toContain("there are, because of the additional month, nine uposathas and one pavāraṇā");

    await change(page, () => page.check(radio("season", "hemanta")));
    await change(page, () => page.selectOption('select[name="fortnight"]', "10"));
    text = await previewText(page);
    expect(text).toContain("Asmiñ-ca utumhi adhikamāsa-vasena dasa uposathā.");
    expect(text).toContain("eko uposatho sampatto,\nnava uposathā atikkantā,\ndasa uposathā paripuṇṇā.");
  }));

  test("note 6: the bhikkhu count, in the form chosen", () => withPage(async (page) => {
    const text = await uposatha(page, [['select[name="bhikkhus"]', "12:2"]]);
    expect(text).toContain("Imasmim-pana uposath’agge bārasa bhikkhū sannipatitā honti.");
    expect(text).toContain("And in this Uposatha hall 12 bhikkhus have gathered.");
  }));

  test("the bracketed alternatives: fourteenth, and the most senior bhikkhu", () => withPage(async (page) => {
    const text = await uposatha(page, [["address", "avuso"]]);
    expect(text).toContain("yathājja uposatho cātuddaso,");
    expect(text).toContain("as today is the fourteenth—then");
    expect(text).toContain("Suṇātu me āvuso saṅgho. Ajj’uposatho cātuddaso.");
    expect(text).toContain("Friends, may the Saṅgha listen to me. Today is the Uposatha of the fourteenth.");
    expect(text).not.toContain("[");
  }));

  test("the Pavāraṇā: extra month, count, harmony day and two statements", () => withPage(async (page) => {
    await change(page, () => page.check('input[name="adhika"]'));
    await change(page, () => page.selectOption('select[name="bhikkhus"]', "23:1"));
    await change(page, () => page.check(radio("day", "harmony")));
    await change(page, () => page.check(radio("statements", "two")));
    const text = await previewText(page);
    expect(text).toContain("Ayaṁ vassānotu. Imasmiñ-ca utumhi adhikamāsa-vasena nava ca uposathā ekā ca pavāraṇā. Iminā pakkhena—");
    expect(text).toContain("satta uposathā atikkantā,\ndve uposathā avasiṭṭhā.");
    expect(text).toMatch(/pavāraṇ’agge tevīsati bhikkhū sannipatitā honti/i);
    expect(text).toContain("Ajja pavāraṇā sāmaggī. Yadi saṅghassa pattakallaṁ, saṅgho dve-vācikaṁ pavāreyya.");
    expect(text).toContain("Ajja pavāraṇā sāmaggī. Yad’āyasmantānaṁ pattakallaṁ");
    // No English for "two statements" or a harmony day in the book: left as printed, marked.
    expect(text).toContain("the Community should invite with three statements.");
    expect(await page.locator("#preview .english .unglossed").count()).toBeGreaterThanOrEqual(2);
  }));

  test("a small-group uposatha", () => withPage(async (page) => {
    await change(page, () => page.check(radio("ceremony", "group")));
    await change(page, () => page.check(radio("address", "avuso")));
    await change(page, () => page.check(radio("day", "fourteenth")));
    const text = await previewText(page);
    expect(text).toContain("Suṇantu me āvuso āyasmantā, ajj’uposatho cātuddaso.");
    expect(text).toContain("listen to me, friends. Today is the uposatha of the fourteenth.");
  }));

  test("only readings that change light up", () => withPage(async (page) => {
    await change(page, () => page.selectOption("#date", UPOSATHA));
    await page.evaluate(() => {
      const w = window as any;
      w.lit = new Set();
      new MutationObserver((ms) => ms.forEach((m) => {
        const t = m.target as HTMLElement;
        if (t.classList?.contains("lit")) w.lit.add(t.dataset.key);
      })).observe(document.getElementById("preview")!, { subtree: true, attributes: true, attributeFilter: ["class"] });
    });
    const lit = async (action: () => Promise<unknown>) => {
      await page.evaluate(() => (window as any).lit.clear());
      await change(page, action);
      await page.waitForTimeout(50);
      return (await page.evaluate(() => [...(window as any).lit])).sort();
    };
    expect(await lit(() => page.check(radio("day", "fifteenth")))).toEqual(["en-day-1", "en-day-2", "pi-day-1", "pi-day-2"]);
    expect(await lit(() => page.check(radio("lang", "english")))).toEqual([]);
    expect(await lit(() => page.check(radio("lang", "both")))).toEqual([]);
    expect(await lit(() => page.check(radio("time", "night")))).toEqual(["en-time-1", "pi-time-1"]);
  }));

  test("follows the PDF's layout and type size", () => withPage(async (page) => {
    const look = () => page.evaluate(() => {
      const p = document.getElementById("preview")!;
      const passage = [...p.querySelectorAll(".passage")].find((x) => x.querySelector(".pali") && x.querySelector(".english"))!;
      const pali = passage.querySelector(".pali")!.getBoundingClientRect();
      const en = passage.querySelector(".english")!;
      const box = en.getBoundingClientRect();
      return {
        layout: p.dataset.layout,
        size: parseFloat(getComputedStyle(p).fontSize),
        english: parseFloat(getComputedStyle(en).fontSize) / parseFloat(getComputedStyle(p).fontSize),
        color: getComputedStyle(en).color,
        beside: Math.abs(box.top - pali.top) < 2 && box.left > pali.right,
      };
    });
    const ink = "rgb(31, 38, 29)";
    const stylus = "rgb(85, 96, 82)";
    const base = await look();
    expect(base).toMatchObject({ layout: "stacked", english: 0.8, color: stylus, beside: false });

    await change(page, () => page.selectOption('select[name="size"]', "14"));
    expect((await look()).size / base.size).toBeCloseTo(14 / 11, 2);

    await change(page, () => page.check(radio("columns", "1")));
    expect(await look()).toMatchObject({ layout: "columns", english: 0.8, color: ink, beside: true });

    await change(page, () => page.check(radio("paper", "booklet")));
    expect(await look()).toMatchObject({ layout: "facing", english: 1, color: ink, beside: true });

    // Not a PDF: no type size, English under the Pāli.
    await change(page, () => page.check(radio("target", "epub")));
    expect(await look()).toMatchObject({ layout: "stacked", size: base.size });

    await change(page, () => page.check(radio("lang", "english")));
    const en = await page.evaluate(() => {
      const p = document.getElementById("preview")!;
      const e = p.querySelector(".english")!;
      return { layout: p.dataset.layout, pali: p.querySelectorAll(".pali").length, ratio: parseFloat(getComputedStyle(e).fontSize) / parseFloat(getComputedStyle(p).fontSize), color: getComputedStyle(e).color };
    });
    expect(en).toEqual({ layout: "single", pali: 0, ratio: 1, color: ink });

    await change(page, () => page.check(radio("lang", "pali")));
    expect(await page.locator("#preview .english").count()).toBe(0);
  }));
});

describe("chapters", () => {
  test("each ceremony starts from its own chapters", () => withPage(async (page) => {
    expect(await checkedChapters(page)).toEqual(["front", "pavarana"]);
    await change(page, () => page.check(radio("ceremony", "group")));
    expect(await checkedChapters(page)).toEqual(["front", "group-uposatha"]);
    await change(page, () => page.check(radio("ceremony", "uposatha")));
    const all = ["front", "pubba-kicca", "pubba-kicca-notes", "nidana", "parajika", "sanghadisesa", "aniyata", "nissaggiya", "pacittiya", "patidesaniya", "sekhiya", "adhikarana-samatha", "conclusion", "after-patimokkha"];
    expect(await checkedChapters(page)).toEqual(all);
    // Pāli only: no notes chapter.
    await change(page, () => page.check(radio("lang", "pali")));
    expect(await checkedChapters(page)).toEqual(all.filter((c) => c !== "pubba-kicca-notes"));
  }));

  test("a chapter's name builds it alone, and Reset brings the selection back", () => withPage(async (page) => {
    await change(page, () => page.selectOption("#date", UPOSATHA));
    expect(await page.isHidden("#reset-chapters")).toBe(true);
    expect(await page.textContent("#chapters-hint")).toBe("Choose a chapter’s name to build that chapter alone.");
    await change(page, () => page.click('button.solo:text-is("Pubba-kicca")'));
    expect(await checkedChapters(page)).toEqual(["pubba-kicca"]);
    expect(await page.isVisible("#reset-chapters")).toBe(true);
    expect(await page.textContent("#cli")).toContain("--chapters pubba-kicca --no-notes");

    // Reset sits at the far end of the Chapters line.
    const legend = await page.locator(".chapter-set legend").boundingBox();
    const reset = await page.locator("#reset-chapters").boundingBox();
    const set = await page.locator(".chapter-set").boundingBox();
    expect(Math.abs(reset!.x + reset!.width - (set!.x + set!.width))).toBeLessThan(2);
    expect(reset!.y).toBeLessThan(legend!.y + legend!.height);

    await change(page, () => page.click("#reset-chapters"));
    expect((await checkedChapters(page)).length).toBe(14);
    expect(await page.isHidden("#reset-chapters")).toBe(true);
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement).value)).toBe("front");

    // A chapter chosen by hand survives a new language or date; a new ceremony replaces it.
    await change(page, () => page.click('button.solo:text-is("Pubba-kicca")'));
    await change(page, () => page.check(radio("lang", "pali")));
    await change(page, () => page.selectOption("#date", "2026-11-24"));
    expect(await checkedChapters(page)).toEqual(["pubba-kicca"]);
    await change(page, () => page.check(radio("ceremony", "group")));
    expect(await checkedChapters(page)).toEqual(["front", "group-uposatha"]);
    await change(page, () => page.check(radio("ceremony", "uposatha")));
    await change(page, () => page.check(radio("lang", "both")));

    // The checkbox still adds and removes one chapter.
    await change(page, () => page.uncheck('input[name="chapter"][value="sekhiya"]'));
    expect(await checkedChapters(page)).not.toContain("sekhiya");
    expect(await page.isVisible("#reset-chapters")).toBe(true);
  }));

  test("no chapters: the build is refused with a reason", () => withPage(async (page) => {
    await change(page, () => page.click('button.solo:text-is("Nidāna")'));
    await change(page, () => page.uncheck('input[name="chapter"][value="nidana"]'));
    expect(await page.textContent("#status")).toBe("Choose at least one chapter.");
    expect(await page.isDisabled("#build")).toBe(true);
    await change(page, () => page.check('input[name="chapter"][value="nidana"]'));
    expect(await page.textContent("#status")).toBe("");
    expect(await page.isEnabled("#build")).toBe(true);
  }));
});

describe("file options", () => {
  test("only the questions that matter for the format are asked", () => withPage(async (page) => {
    const visible = async () => ({
      paper: await shown(page, 'input[name="paper"]'),
      columns: await shown(page, 'input[name="columns"]'),
      size: await shown(page, 'select[name="size"]'),
      signature: await shown(page, 'select[name="signature"]'),
      instructions: await shown(page, 'input[name="instructions"]'),
      button: await page.textContent("#build"),
    });
    expect(await visible()).toEqual({ paper: true, columns: true, size: true, signature: false, instructions: true, button: "Build A5 PDF" });
    await change(page, () => page.check(radio("paper", "booklet")));
    expect(await visible()).toEqual({ paper: true, columns: false, size: true, signature: true, instructions: true, button: "Build A5 booklet" });
    await change(page, () => page.check(radio("paper", "a4")));
    expect((await visible()).button).toBe("Build A4 PDF");
    await change(page, () => page.check(radio("lang", "pali")));
    expect(await visible()).toEqual({ paper: true, columns: false, size: true, signature: false, instructions: false, button: "Build A4 PDF" });
    expect((await formState(page)).size).toBe("12");
    await change(page, () => page.check(radio("lang", "english")));
    expect((await formState(page)).size).toBe("11");
    for (const [target, label] of [["epub", "EPUB"], ["html", "HTML"], ["md", "Markdown"]]) {
      await change(page, () => page.check(radio("target", target!)));
      expect(await visible()).toEqual({ paper: false, columns: false, size: false, signature: false, instructions: true, button: `Build ${label}` });
    }
  }));

  test("the command line says exactly what will be built", () => withPage(async (page) => {
    await change(page, () => page.selectOption("#date", UPOSATHA));
    await change(page, () => page.check(radio("lang", "pali")));
    await change(page, () => page.check(radio("paper", "booklet")));
    await change(page, () => page.selectOption('select[name="size"]', "13"));
    await change(page, () => page.selectOption('select[name="signature"]', "16"));
    await change(page, () => page.click('button.solo:text-is("Pubba-kicca")'));
    await change(page, () => page.check(radio("time", "night")));
    await change(page, () => page.check(radio("helpers", "aramikas")));
    await change(page, () => page.selectOption('select[name="bhikkhus"]', "12:2"));
    await change(page, () => page.check(radio("address", "avuso")));
    expect(await page.textContent("#cli")).toBe(
      "bun run build -- pdf --lang pali --paper booklet --size 13 --signature 16 --chapters pubba-kicca --no-notes --no-instructions " +
      "--time night --helpers aramikas --season vassana --fortnight 7 --bhikkhus 12:2 --day fourteenth --address avuso");
    await change(page, () => page.check(radio("lang", "both")));
    await change(page, () => page.check(radio("paper", "a4")));
    await change(page, () => page.check(radio("columns", "1")));
    expect(await page.textContent("#cli")).toMatch(/^bun run build -- pdf --lang both --paper a4 --size 11 --columns --chapters pubba-kicca --no-notes --instructions /);
  }));
});

describe("without the server", () => {
  test("downloads still work; the form says why it can't build", () => withPage(async (page) => {
    await page.waitForFunction(() => document.getElementById("status")!.textContent !== "");
    expect(await page.textContent("#status")).toBe("Custom builds need the site’s server, which isn’t answering. The downloads above still work.");
    expect(await page.isDisabled("#build")).toBe(true);
    expect(await previewText(page)).toContain("Ajj’uposatho paṇṇaraso [cātuddaso].");
    expect(await page.locator("table.downloads a").count()).toBe(18);
  }, { offline: true }));
});

describe("narrow screens", () => {
  test("a phone gets one column, the table as blocks, and labels that wrap whole", () => withPage(async (page) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await page.locator("table.downloads thead").isHidden()).toBe(true);
    const occasion = await page.locator(".occasion").boundingBox();
    const preview = await page.locator(".preview").boundingBox();
    expect(preview!.y).toBeGreaterThan(occasion!.y + occasion!.height - 1);
    // "The season has an extra month, adhikamāsa" stays one label, not two columns.
    const label = page.locator('label.choice:has(input[name="adhika"]) > span');
    expect(await label.count()).toBe(1);
  }, { width: 390 }));

  test("keyboard focus is visible", () => withPage(async (page) => {
    await page.focus(radio("ceremony", "uposatha"));
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).toBe("solid");
  }));
});

describe("the API", () => {
  const post = (path: string, body: unknown) =>
    fetch(site.url + path, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const valid = { ceremony: "uposatha", lang: "both", target: "pdf", paper: "a5", size: 11, chapters: ["pubba-kicca"], occasion: {} };

  test("health", async () => {
    const res = await fetch(site.url + "api/health");
    expect(await res.json()).toMatchObject({ ok: true, running: 0, waiting: 0 });
  });

  test("impossible occasions are refused, in the preview and the build", async () => {
    const bad = { ...valid, occasion: { season: "vassana", fortnight: 6 } };
    expect((await (await post("api/preview", bad)).json()).errors).toEqual(["uposatha 6 during a normal rainy season is the Pavāraṇā"]);
    const res = await post("api/build", bad);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("uposatha 6 during a normal rainy season is the Pavāraṇā");
    for (const occasion of [{ bhikkhus: 115 }, { bhikkhus: 12, form: 3 }, { season: "monsoon" }, { fortnight: 1.5 }]) {
      expect((await post("api/build", { ...valid, occasion })).status).toBe(400);
    }
    expect((await post("api/build", { ...valid, chapters: ["../../etc"] })).status).toBe(400);
    expect((await post("api/build", { ...valid, signature: 18, paper: "booklet" })).status).toBe(400);
    expect((await post("api/build", { ...valid, target: "docx" })).status).toBe(400);
  });

  test("corrections can't be asked for", async () => {
    const { command } = await (await post("api/preview", { ...valid, corrections: true })).json();
    expect(command).not.toContain("--corrections");
  });

  test("bad requests", async () => {
    expect((await post("api/build", "not json")).status).toBe(400);
    expect((await post("api/build", JSON.stringify({ ...valid, pad: "x".repeat(20_000) }))).status).toBe(413);
    expect((await fetch(site.url + "api/nothing")).status).toBe(404);
    expect((await fetch(site.url, { method: "POST" })).status).toBe(405);
    expect((await fetch(site.url + "..%2F..%2Fpackage.json")).status).toBe(404);
    expect((await fetch(site.url + "files/..%2F..%2F..%2Fpackage.json")).status).toBe(404);
  });
});
