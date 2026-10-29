/**
 * The particular uposatha or pavāraṇā a build is prepared for.
 *
 * Every field is optional; an empty occasion prints the book as it stands (its default readings
 * and its bracketed alternatives). Each substituted reading comes from the book itself: the
 * Preliminary Duties notes (content/02-pubba-kicca-notes.md), the bracketed alternatives in the
 * text, or the Pavāraṇā chapter's own notes and instructions. Substitution points are marked
 * in the content with `{% slot name="…" %}`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface Occasion {
  /** Note 1: a recitation held at night has no "no lamp-duty" clause. */
  time?: "day" | "night";
  /** Note 2: who helped with the preliminary tasks. */
  helpers?: "bhikkhus" | "samaneras" | "aramikas";
  /** Note 3. */
  season?: "hemanta" | "gimha" | "vassana";
  /** Notes 4, 5 and p1: a season with an additional month (adhikamāsa). */
  adhika?: boolean;
  /** Note 5: which uposatha of the season this is (1-based). */
  fortnight?: number;
  /** Note 6: the number of bhikkhus present… */
  bhikkhus?: number;
  /** …and which of the book's Pāli forms of that number to use (1-based). */
  form?: number;
  /** The bracketed alternatives paṇṇaraso [cātuddaso]; "harmony" is the Pavāraṇā's sāmaggī. */
  day?: "fifteenth" | "fourteenth" | "harmony";
  /** bhante [āvuso]: āvuso when the reciter is the most senior bhikkhu. */
  address?: "bhante" | "avuso";
  /** Pavāraṇā: te-vācikaṁ, dve-vācikaṁ or eka-vācikaṁ. */
  statements?: "three" | "two" | "one";
}

export const OCCASION_CHOICES = {
  time: ["day", "night"],
  helpers: ["bhikkhus", "samaneras", "aramikas"],
  season: ["hemanta", "gimha", "vassana"],
  day: ["fifteenth", "fourteenth", "harmony"],
  address: ["bhante", "avuso"],
  statements: ["three", "two", "one"],
} as const;

const NOTES = readFileSync(join(import.meta.dir, "..", "content", "02-pubba-kicca-notes.md"), "utf8").normalize("NFC");

const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];

export interface SeasonTable {
  title: string;
  /** Index = fortnight - 1. A string is the reading; null is the Pavāraṇā. */
  entries: (string | null)[];
}

/**
 * Note 5's four tables, in the book's order: normal hot/cold, normal rainy, hot/cold with an
 * additional month, rainy with an additional month. The normal hot/cold table starts at the
 * second uposatha; its first is the reading printed in the text.
 */
export const SEASON_TABLES: SeasonTable[] = [...NOTES.matchAll(/\{% season-table title="([^"]+)" %\}\n([\s\S]*?)\{% \/season-table %\}/g)]
  .map(([, title, body], i) => {
    const entries: (string | null)[] = i === 0 ? ["satta uposathā avasiṭṭhā"] : [];
    for (const line of body!.trim().split("\n")) {
      const m = line.match(/^- (\w+): (.*)$/);
      if (!m) throw new Error(`season table: cannot read ${line}`);
      if (ORDINALS.indexOf(m[1]!) !== entries.length) throw new Error(`season table: ${m[1]} out of order`);
      const reading = m[2]!.match(/^\*(.+)\.\*$/);
      entries.push(reading ? reading[1]! : null);
    }
    return { title: title!, entries };
  });
if (SEASON_TABLES.length !== 4) throw new Error(`expected 4 season tables in the notes, found ${SEASON_TABLES.length}`);

/** Note 6's numbers: n → the Pāli forms the book gives. Four (cattāro) is the reading in the text. */
export const NUMBERS: Map<number, string[]> = new Map([
  [4, ["cattāro"]],
  ...[...NOTES.matchAll(/^- (\d+): (.+)$/gm)].map(([, n, forms]) => [Number(n), forms!.split(", ")] as [number, string[]]),
]);

export const tableFor = (o: Occasion) => SEASON_TABLES[(o.adhika ? 2 : 0) + (o.season === "vassana" ? 1 : 0)]!;

/** The reasons an occasion cannot be printed, if any. */
export function occasionErrors(o: Occasion): string[] {
  const errors: string[] = [];
  for (const [k, allowed] of Object.entries(OCCASION_CHOICES)) {
    const v = (o as any)[k];
    if (v !== undefined && !(allowed as readonly string[]).includes(v)) errors.push(`${k} must be one of ${allowed.join(", ")}`);
  }
  if (o.fortnight !== undefined) {
    const t = tableFor(o);
    if (!Number.isInteger(o.fortnight) || o.fortnight < 1 || o.fortnight > t.entries.length) {
      errors.push(`fortnight must be 1–${t.entries.length} ${t.title.replace(/^During /, "during ").replace(/:$/, "")}`);
    } else if (t.entries[o.fortnight - 1] === null) {
      errors.push(`uposatha ${o.fortnight} ${t.title.replace(/^During /, "during ").replace(/:$/, "")} is the Pavāraṇā`);
    }
  }
  if (o.bhikkhus !== undefined) {
    const forms = NUMBERS.get(o.bhikkhus);
    if (!forms) errors.push(`the book gives no Pāli for ${o.bhikkhus} bhikkhus (note 6 lists 4–110, then tens and hundreds)`);
    else if (o.form !== undefined && !(Number.isInteger(o.form) && o.form >= 1 && o.form <= forms.length)) {
      errors.push(`${o.bhikkhus} has ${forms.length} Pāli form(s) in the book; form must be 1–${forms.length}`);
    }
  }
  return errors;
}

export type Lang = "pi" | "en";

/**
 * What a slot reads for an occasion: Markdoc source, or undefined for the printed text.
 * `changed` is true when the occasion departs from the printed reading — an English slot that
 * is changed but has no `source` keeps the book's English, because the book gives none for the
 * new reading.
 */
export interface Reading { source?: string; changed: boolean }

const as = (source: string | undefined, changed: boolean): Reading => ({ source: changed ? source : undefined, changed });

const COUNTS: Record<string, string> = {
  eko: "one", dve: "two", tayo: "three", cattāro: "four", pañca: "five",
  cha: "six", satta: "seven", aṭṭha: "eight", nava: "nine", dasa: "ten",
};
const VERBS: Record<string, [string, string]> = { // [singular, plural]
  atikkant: ["has passed", "have passed"],
  avasiṭṭh: ["remains", "remain"],
  paripuṇṇ: ["is complete", "are complete"],
};

/**
 * Note 5's counts in English. The book glosses none of them, so each clause is rendered on the
 * pattern of the passage's own "This number (of Uposathas) is past; this number remains" and its
 * printed "seven Uposathas remain" (audit/README.md).
 */
export function remainingEnglish(entry: string): string {
  return entry.split(", ").map((clause) => {
    const m = clause.match(/^(\S+) (ca )?uposath[āo] (ekā ca pavāraṇā )?(atikkant|avasiṭṭh|paripuṇṇ)[āo]$/);
    const count = m && COUNTS[m[1]!];
    if (!m || !count) throw new Error(`note 5: cannot translate "${clause}"`);
    const plural = count !== "one" || !!m[3];
    const what = `${count} Uposatha${count === "one" ? "" : "s"}${m[3] ? " and one Pavāraṇā" : ""}`;
    return `{% var %}${what}{% /var %} ${VERBS[m[4]!]![plural ? 1 : 0]}`;
  }).join(";\\\n");
}

/** Readings from the notes, by slot name. Attribute-driven slots (day, address…) are handled in the schema. */
export function reading(name: string, lang: Lang, o: Occasion): Reading {
  const pi = lang === "pi";
  switch (name) {
    case "time": // note 1. English adapted from the note's gloss "Of the first four…" (audit/README.md).
      return as(pi ? `{% var note="1" %}Tattha purimāni cattāri{% /var %}` : `The first four`, o.time === "night");

    case "helpers": { // note 2
      const h = o.helpers ?? "bhikkhus";
      const text = { bhikkhus: ["", ""], samaneras: ["sāmaṇerehi-pi bhikkhūhi-pi", "novices and bhikkhus"], aramikas: ["ārāmikehi-pi bhikkhūhi-pi", "monastery dwellers and bhikkhus"] }[h];
      return as(pi ? `{% var note="2" %}${text[0]}{% /var %}` : text[1], h !== "bhikkhus");
    }

    case "season": { // note 3. English from the passage's own list: "winter, summer, and the rainy season".
      const s = o.season ?? "hemanta";
      const text = { hemanta: ["hemantotu", "winter"], gimha: ["gimhotu", "summer"], vassana: ["vassānotu", "rainy season"] }[s];
      return as(pi ? `{% var note="3" %}${text[0]}{% /var %}` : `{% var %}${text[1]}{% /var %}`, s !== "hemanta");
    }

    case "uposathas": { // note 4, with its English glosses
      const rainy = o.season === "vassana";
      const [p, e] = o.adhika
        ? rainy
          ? ["adhikamāsa-vasena nava ca uposathā ekā ca pavāraṇā", "there are, because of the additional month, {% var %}nine uposathas and one pavāraṇā{% /var %}"]
          : ["adhikamāsa-vasena dasa uposathā", "there are, because of the additional month, {% var %}ten uposathas{% /var %}"]
        : rainy
          ? [`{% sic correction="satta" %}sattā{% /sic %} ca uposathā ekā ca pavāraṇā`, "there are {% var %}seven uposathas and one pavāraṇā{% /var %}"]
          : ["", ""];
      return as(pi ? `{% var note="4" %}${p}{% /var %}` : e, rainy || !!o.adhika);
    }

    case "remaining": { // note 5; the book sets each clause on its own line, as in the Pavāraṇā
      const n = o.fortnight ?? 1;
      const t = tableFor(o);
      const entry = t.entries[n - 1];
      const changed = t !== SEASON_TABLES[0] || n !== 1;
      if (!entry) return { changed };
      if (!pi) return as(remainingEnglish(entry), changed);
      return as(`{% var note="5" %}${entry.replace(/, /g, ",\\\n")}{% /var %}`, changed);
    }

    case "bhikkhus": // note 6. English: the note's own numeral.
    case "bhikkhus-pavarana": {
      const printed = name === "bhikkhus" ? 4 : 5;
      const n = o.bhikkhus ?? printed;
      const forms = NUMBERS.get(n);
      const form = forms?.[(o.form ?? 1) - 1];
      const changed = n !== printed || (o.form ?? 1) !== 1;
      if (!form) return { changed: false };
      if (name === "bhikkhus-pavarana") return as(form, changed); // printed without var styling
      return as(pi ? `{% var note="6" %}${form}{% /var %}` : `{% var %}${n === 4 ? "four" : n}{% /var %}`, changed);
    }

    // Note p1 (Pavāraṇā in a rainy season with an additional month).
    case "pavarana-uposathas":
      return as("adhikamāsa-vasena nava ca uposathā ekā ca pavāraṇā", !!o.adhika);
    case "pavarana-past":
      return as("satta uposathā atikkantā", !!o.adhika);
  }
  throw new Error(`unknown slot "${name}"`);
}

export const SLOT_NAMES = ["time", "helpers", "season", "uposathas", "remaining", "bhikkhus", "bhikkhus-pavarana", "pavarana-uposathas", "pavarana-past"];
/** Slots whose readings are given as attributes in the content: the bracketed alternatives. */
export const ATTRIBUTE_SLOTS = { day: "day", address: "address", statements: "statements" } as const;
