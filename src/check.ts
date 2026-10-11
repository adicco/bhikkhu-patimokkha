#!/usr/bin/env bun
/**
 * Audit the Pāli text.
 *
 *   bun run check            # all checks
 *   DPD_DB=path bun run check
 *
 * 1. Markdoc validation against the schema.
 * 2. Structure: rule counts per class and consecutive numbering.
 * 3. Characters: NFC, no stray/foreign diacritics (ṃ, ŋ, combining marks, ASCII look-alikes).
 * 4. Suspicious word-final "m" (possible missing ṁ).
 * 5. Every Pāli word looked up in the Digital Pāḷi Dictionary (DPD); unknown words are
 *    listed with their location so they can be checked against the printed book.
 */
import { Database } from "bun:sqlite";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Tag, type RenderableTreeNode } from "@markdoc/markdoc";
import { loadChapters, render, validate } from "./load";
import { showFor } from "./options";

const chapters = loadChapters();
let problems = 0;
const report: string[] = [];
const log = (s = "") => { report.push(s); console.log(s); };

// 1. Validation
const errors = validate(chapters);
log(`# Pāli audit\n\n## Markdoc validation: ${errors.length ? errors.length + " problem(s)" : "ok"}`);
for (const e of errors) { problems++; log(`- ${e.file}:${e.line} ${e.id}: ${e.message}`); }

// 2. Structure
const EXPECTED: Record<string, number> = { parajika: 4, sanghadisesa: 13, aniyata: 2, nissaggiya: 30, pacittiya: 92, patidesaniya: 4, sekhiya: 75 };
log(`\n## Rule counts`);
for (const [cls, want] of Object.entries(EXPECTED)) {
  const ns: number[] = [];
  for (const c of chapters) for (const m of c.ast.walk()) {
    if (m.type === "tag" && m.tag === "rule" && m.attributes.class === cls) ns.push(m.attributes.n);
  }
  const seqOk = ns.every((n, i) => n === i + 1);
  const ok = ns.length === want && seqOk;
  if (!ok) problems++;
  log(`- ${cls}: ${ns.length}/${want}${seqOk ? "" : " (numbering out of sequence)"} ${ok ? "ok" : "PROBLEM"}`);
}

// Collect Pāli text with locations.
interface Run { where: string; text: string }
const runs: Run[] = [];
const show = showFor("pali");
for (const { chapter, tree } of render(chapters, show)) {
  const visit = (n: RenderableTreeNode, where: string) => {
    if (typeof n === "string") { runs.push({ where, text: n }); return; }
    if (!Tag.isTag(n)) return;
    if (n.name === "sup" || n.attributes.class === "num") return;
    const id = n.attributes.id ? `${chapter.file}#${n.attributes.id}` : where;
    n.children.forEach((c) => visit(c, id));
  };
  visit(tree, chapter.file);
}
// Title page subtitle is English.
const pali = runs.filter((r) => !/^Pāli – English$/.test(r.text));

// 3. Characters
log(`\n## Characters`);
const ALLOWED = /[A-Za-zĀāĪīŪūṀṁṄṅÑñṬṭḌḍṆṇḶḷ0-9\s.,;:?!'"“”‘’()\[\]—–\-…\/]/u;
const badChars = new Map<string, Set<string>>();
for (const r of pali) {
  if (r.text !== r.text.normalize("NFC")) { problems++; log(`- not NFC: ${r.where}`); }
  for (const ch of r.text) if (!ALLOWED.test(ch)) {
    const k = `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")} ${JSON.stringify(ch)}`;
    if (!badChars.has(k)) badChars.set(k, new Set());
    badChars.get(k)!.add(r.where);
  }
}
if (!badChars.size) log("- ok (only the expected Pāli letters and punctuation)");
for (const [k, w] of badChars) { problems++; log(`- unexpected ${k} in ${[...w].slice(0, 5).join(", ")}`); }

// Tokenise
const words: { word: string; where: string }[] = [];
for (const r of pali) for (const w of r.text.split(/[\s.,;:?!"“”‘()\[\]—–…\/]+/u)) {
  const t = w.replace(/^['’\-]+|['’\-]+$/g, "");
  if (t && /\p{L}/u.test(t)) words.push({ word: t, where: r.where });
}

// 4. Word-final m
log(`\n## Word-final "m" (expect ṁ unless sandhi before a vowel)`);
const finalM = words.filter((w) => /m$/.test(w.word));
if (!finalM.length) log("- none");
for (const w of finalM) { log(`- "${w.word}" in ${w.where}`); }

// 5. DPD
const dbPath = process.env.DPD_DB ?? join(homedir(), "Downloads", "dpd.db");
log(`\n## Dictionary (DPD: ${dbPath})`);
if (!existsSync(dbPath)) {
  log("- skipped: DPD database not found (set DPD_DB)");
} else {
  const db = new Database(dbPath, { readonly: true });
  const q = db.query("select 1 from lookup where lookup_key = ?");
  const cache = new Map<string, boolean>();
  const known = (k: string) => {
    if (!k) return true;
    if (!cache.has(k)) cache.set(k, !!q.get(k));
    return cache.get(k)!;
  };
  const norm = (s: string) => s.toLowerCase().replace(/ṁ/g, "ṃ").replace(/[’]/g, "'");
  // Elided forms before an apostrophe: try the common full forms.
  const elided = (p: string) => [p, p + "a", p + "ā", p + "i", p + "e", p + "o", p + "u", p.replace(/m$/, "ṃ"), p.replace(/n$/, "ṃ"), p.replace(/ñ$/, "ṃ"), p.replace(/ṅ$/, "ṃ")];
  // Sandhi consonants before -ca/-pi/-eva etc.: tañ-ca → taṃ ca
  const unsandhi = (p: string) => [p, p.replace(/[mnñṅ]$/, "ṃ"), short(p)];
  // A final vowel is lengthened before the quotative "ti" (passāmī ti, vacanāyā ti).
  const short = (p: string) => p.replace(/ā$/, "a").replace(/ī$/, "i").replace(/ū$/, "u");

  function check(raw: string): string[] {
    const w = norm(raw);
    const joined = w.replace(/['\-]/g, "");
    if ([w, joined, w.replace(/-/g, "")].some((k) => known(k) || known(short(k)))) return [];
    // Split on hyphens and apostrophes; every part must be explainable.
    const missing: string[] = [];
    const segs = w.split("-");
    for (const seg of segs) {
      const [head, ...tail] = seg.split("'");
      if (seg.includes("'")) {
        if (known(seg.replace(/'/g, ""))) continue;
        if (!elided(head!).some(known) && !unsandhi(head!).some(known)) missing.push(head + "'");
        for (const t of tail) if (!known(t) && !unsandhi(t).some(known)) missing.push("'" + t);
      } else if (!unsandhi(seg).some(known)) missing.push(seg);
    }
    return missing;
  }

  const unknown = new Map<string, { parts: string[]; where: Set<string> }>();
  for (const { word, where } of words) {
    const missing = check(word);
    if (!missing.length) continue;
    if (!unknown.has(word)) unknown.set(word, { parts: missing, where: new Set() });
    unknown.get(word)!.where.add(where);
  }
  const distinct = new Set(words.map((w) => w.word)).size;
  log(`- ${words.length} words (${distinct} distinct); ${unknown.size} not resolved in DPD:`);
  for (const [w, { parts, where }] of [...unknown].sort((a, b) => a[0].localeCompare(b[0], "pi"))) {
    log(`  - **${w}**${parts.join("") !== norm(w) ? ` (unresolved: ${parts.join(", ")})` : ""} — ${[...where].slice(0, 4).join(", ")}${where.size > 4 ? ` +${where.size - 4}` : ""}`);
  }
}

// 6. Readings in the printed book that look like typos ({% sic %}). Builds show the book's
// reading by default; `--corrections` substitutes the suggested reading.
log(`\n## Book readings marked {% sic %} (shown as printed unless built with --corrections)`);
for (const c of chapters) for (const n of c.ast.walk()) {
  if (n.type === "tag" && n.tag === "sic") {
    const printed = [...n.walk()].filter((t) => t.type === "text").map((t) => t.attributes.content).join("");
    log(`- ${c.file}:${n.lines[0]! + 1} printed **${printed}** → suggested **${n.attributes.correction}**`);
  }
}

writeFileSync(join(import.meta.dir, "..", "audit", "check-report.md"), report.join("\n") + "\n");
if (problems) { console.error(`\n${problems} structural problem(s)`); process.exit(1); }
