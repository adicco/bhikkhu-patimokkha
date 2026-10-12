#!/usr/bin/env bun
/**
 * Builds the Pāṭimokkha to Markdown, HTML, EPUB and PDF. Run with --help for the options.
 *
 * The occasion options (time … statements) fill in the readings that change from one uposatha to
 * the next, from the book's notes; see src/occasion.ts. Unset, the book's printed readings are kept.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { baseName } from "./artifacts";
import { orList, parseCli, suggest, usageError } from "./cli";
import { loadChapters, render, validate } from "./load";
import { showFor, type Lang } from "./options";
import { occasionErrors, OCCASION_CHOICES, type Occasion } from "./occasion";
import { toMarkdown } from "./writers/markdown";
import { toHtml } from "./writers/html";
import { toLatex } from "./writers/latex";

const HELP = `
Usage: bun run build [targets…] [options]

Targets: md html epub pdf all (default: all). Outputs go to <out>/<lang>/.

Output:
  --lang pali|english|both      language(s) to include (default: both)
  --out DIR                     output directory (default: dist)
  --chapters SLUG,SLUG…         only these chapters (a wrong slug lists the available ones)
  --notes, --no-notes           include/omit the notes (default: on unless --lang pali)
  --instructions, --no-instructions
                                include/omit the English rubrics (default: on unless --lang pali)
  --corrections, --no-corrections
                                print the suggested correction for {% sic %} readings,
                                or the book's own reading (default: corrections)

PDF:
  --paper a4,a5,booklet         paper sizes to make (default: all three)
  --size PT                     font size in points, e.g. 13 or 10.5 (default: 13 for pali, else 11)
  --columns                     bilingual A4/A5 side by side instead of stacked
  --signature N                 split the booklet into gatherings of N pages (multiple of 4)

Occasion (fill in the readings that change; unset keeps the book's printed readings):
  --time day|night
  --helpers bhikkhus|samaneras|aramikas
  --season hemanta|gimha|vassana
  --adhika                      a year with an extra (adhika) month
  --fortnight N                 which uposatha of the season
  --bhikkhus N[:FORM]           number of bhikkhus present, and which Pāli form if the book gives several
  --day fifteenth|fourteenth|harmony
  --address bhante|avuso
  --statements three|two|one    for the Pavāraṇā

  -h, --help                    show this help

Examples:
  bun run build pdf --lang pali --paper booklet
  bun run build html --season vassana --fortnight 3 --bhikkhus 12
`;

const { values, positionals } = parseCli("src/build.ts", HELP, {
  lang: { type: "string", default: "both" },
  paper: { type: "string" },
  size: { type: "string" },
  signature: { type: "string" },
  columns: { type: "boolean", default: false },
  notes: { type: "boolean" },
  "no-notes": { type: "boolean" },
  instructions: { type: "boolean" },
  "no-instructions": { type: "boolean" },
  corrections: { type: "boolean" },
  "no-corrections": { type: "boolean" },
  out: { type: "string", default: "dist" },
  chapters: { type: "string" },
  time: { type: "string" },
  helpers: { type: "string" },
  season: { type: "string" },
  adhika: { type: "boolean" },
  fortnight: { type: "string" },
  bhikkhus: { type: "string" },
  day: { type: "string" },
  address: { type: "string" },
  statements: { type: "string" },
}, true);

const fail = (message: string): never => usageError("src/build.ts", message);
/** `value` if it is one of `choices`; otherwise exit with the choices and a likely intended one. */
function oneOf<T extends string>(what: string, value: string, choices: readonly T[]): T {
  if ((choices as readonly string[]).includes(value)) return value as T;
  const guess = suggest(value, choices);
  return fail(`${what} must be ${orList(choices)}, not '${value}'${guess ? ` (did you mean ${guess}?)` : ""}`);
}
/** `value` as a positive whole number, or exit. */
function count(option: string, value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fail(`--${option} must be a positive whole number, not '${value}'`);
}

const lang = oneOf("--lang", values.lang!, ["pali", "english", "both"]) as Lang;
const TARGETS = ["md", "html", "epub", "pdf", "all"] as const;
for (const t of positionals) oneOf("a target", t, TARGETS);
const targets = new Set(positionals.length && !positionals.includes("all") ? positionals : ["md", "html", "epub", "pdf"]);
for (const [k, choices] of Object.entries(OCCASION_CHOICES)) {
  const v = values[k as keyof typeof OCCASION_CHOICES];
  if (v !== undefined) oneOf(`--${k}`, v, choices);
}
const papers = new Set((values.paper ?? "a4,a5,booklet").split(",").map((p) => oneOf("--paper", p.trim().toLowerCase(), ["a4", "a5", "booklet"])));
const fontSize = values.size === undefined ? (lang === "pali" ? 13 : 11) : Number(values.size);
if (!(fontSize >= 6 && fontSize <= 30)) fail(`--size must be a font size in points from 6 to 30, not '${values.size}'`);
const sig = values.signature === undefined ? 0 : count("signature", values.signature);
if (sig % 4) fail(`--signature must be a multiple of 4, not ${sig}`);
if (values.bhikkhus !== undefined && !/^\d+(:\d+)?$/.test(values.bhikkhus)) fail(`--bhikkhus must be N or N:FORM (e.g. 12 or 12:2), not '${values.bhikkhus}'`);
if (values.fortnight !== undefined) count("fortnight", values.fortnight);

const flag = (on?: boolean, off?: boolean) => (on ? true : off ? false : undefined);
const overrides = Object.fromEntries(Object.entries({
  notes: flag(values.notes, values["no-notes"]),
  instructions: flag(values.instructions, values["no-instructions"]),
  corrections: flag(values.corrections, values["no-corrections"]),
}).filter(([, v]) => v !== undefined));
const show = showFor(lang, overrides);

const chapters = loadChapters();
const errors = validate(chapters);
if (errors.length) {
  for (const e of errors) console.error(`${e.file}:${e.line ?? "?"} ${e.level} ${e.id}: ${e.message}`);
  if (errors.some((e) => e.level === "error" || e.level === "critical")) process.exit(1);
}

const [bhikkhus, form] = (values.bhikkhus ?? "").split(":").map((n) => (n ? Number(n) : undefined));
const occasion = Object.fromEntries(Object.entries({
  time: values.time, helpers: values.helpers, season: values.season, adhika: values.adhika,
  fortnight: values.fortnight ? Number(values.fortnight) : undefined, bhikkhus, form,
  day: values.day, address: values.address, statements: values.statements,
}).filter(([, v]) => v !== undefined)) as Occasion;
const occasionProblems = occasionErrors(occasion);
if (occasionProblems.length) fail(occasionProblems.join("; "));

const only = values.chapters?.split(",").map((c) => c.trim()).filter(Boolean);
const unknownChapters = only?.filter((slug) => !chapters.some((c) => c.slug === slug));
if (unknownChapters?.length) fail(`unknown chapters: ${unknownChapters.join(", ")}\nAvailable: ${chapters.map((c) => c.slug).join(", ")}`);

const rendered = render(chapters, show, occasion, only);
const title = `Bhikkhu Pāṭimokkha (${{ pali: "Pāli", english: "English", both: "Pāli–English" }[lang]})`;
const base = baseName(lang);
const outDir = join(values.out!, lang);
mkdirSync(outDir, { recursive: true });

/** A UUID-shaped digest of `s`. */
function uuidFrom(s: string) {
  const h = new Bun.CryptoHasher("sha256").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * LuaLaTeX on `${name}.tex`, with the PDF's trailer ID taken from the source instead of the clock.
 * With SOURCE_DATE_EPOCH and FORCE_SOURCE_DATE=1 set (as `bun run release` does), the same source
 * then gives a byte-identical PDF, which is what lets releases name files by content hash.
 */
function lualatex(name: string) {
  const id = new Bun.CryptoHasher("md5").update(readFileSync(join(outDir, `${name}.tex`))).digest("hex");
  return ["lualatex", "-interaction=nonstopmode", "-halt-on-error", `-jobname=${name}`,
    `\\pdfvariable trailerid {[<${id}> <${id}>]}\\input{${name}.tex}`];
}

/** Gentium Plus's regular, italic, bold and bold italic files, wherever fontconfig finds them. */
function gentiumFiles() {
  const out = Bun.spawnSync(["fc-list", ":family=Gentium Plus", "file"]).stdout.toString();
  const files = out.split("\n").map((l) => l.replace(/:\s*$/, "").trim()).filter((f) => /GentiumPlus-(Regular|Italic|Bold|BoldItalic)\.ttf$/.test(f));
  if (files.length < 4) throw new Error("Gentium Plus (Regular, Italic, Bold, BoldItalic) not found by fc-list");
  return files.sort();
}

async function run(cmd: string[], cwd = outDir) {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const code = await p.exited;
  if (code !== 0) {
    const err = await new Response(p.stderr).text();
    const out = await new Response(p.stdout).text();
    throw new Error(`${cmd[0]} failed (${code}):\n${(out + err).split("\n").filter((l) => /^!|Error|error/.test(l)).slice(0, 20).join("\n") || (out + err).slice(-2000)}`);
  }
}

if (targets.has("md")) {
  const md = toMarkdown(rendered, show);
  const dir = join(outDir, "md");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const c of md) writeFileSync(join(dir, c.file), c.markdown);
  writeFileSync(join(outDir, `${base}.md`), md.map((c) => c.markdown).join("\n---\n\n"));
  console.log(`md    ${join(outDir, `${base}.md`)} (+ ${md.length} chapter files in md/)`);
}

if (targets.has("html") || targets.has("epub")) {
  writeFileSync(join(outDir, `${base}.html`), toHtml(rendered, show, { title }));
  if (targets.has("html")) console.log(`html  ${join(outDir, `${base}.html`)}`);
}

if (targets.has("epub")) {
  const css = join(import.meta.dir, "..", "assets", "style.css");
  const epubHtml = join(outDir, `.${base}.epub.html`);
  const epubSource = toHtml(rendered, show, { title, standalone: false, embedCss: false });
  writeFileSync(epubHtml, epubSource);
  await run([
    "pandoc", `.${base}.epub.html`, "-f", "html", "-o", `${base}.epub`,
    "--css", css, "--split-level=2", "--toc", "--toc-depth=2",
    "--metadata", `title=${title}`, "--metadata", "author=Ṭhānissaro Bhikkhu (tr.)",
    "--metadata", `lang=${show.pali && !show.english ? "pi" : "en"}`,
    // Derived from the content rather than random, so that the same text gives the same file.
    "--metadata", `identifier=urn:uuid:${uuidFrom(epubSource)}`,
    ...gentiumFiles().map((f) => `--epub-embed-font=${f}`),
  ]);
  rmSync(epubHtml);
  console.log(`epub  ${join(outDir, `${base}.epub`)}`);
}

if (targets.has("pdf")) {
  // A4, A5, and A5 pages imposed 2-up on A4 landscape for a folded booklet.
  // Bilingual A4/A5 put the English under the Pāli (or beside it with --columns); the booklet
  // follows the printed book: Pāli on the left page, English on the facing right page.

  const layout = values.columns ? "columns" : "stacked";
  async function typeset(paper: "a4" | "a5", layout: "stacked" | "columns" | "facing", name = `${base}.${paper}`) {
    writeFileSync(join(outDir, `${name}.tex`), toLatex(rendered, show, { title, paper, fontSize, layout }));
    for (let i = 0; i < 2; i++) await run(lualatex(name));
    for (const ext of ["aux", "log", "out", "toc"]) rmSync(join(outDir, `${name}.${ext}`), { force: true });
    return `${name}.pdf`;
  }

  if (papers.has("a4")) console.log(`pdf   ${join(outDir, await typeset("a4", layout))}`);
  if (papers.has("a5")) console.log(`pdf   ${join(outDir, await typeset("a5", layout))}`);
  if (papers.has("booklet")) {
    const a5 = await typeset("a5", "facing", `${base}.a5-facing`);
    // Saddle-stitch imposition: pages padded to a multiple of 4 and reordered so that the
    // A4 sheets, printed double-sided (flip on short edge), folded and nested, read in order.
    // --signature N splits it into folded gatherings of N pages (multiple of 4) for sewing.
    const name = `${base}.a5-booklet`;
    writeFileSync(join(outDir, `${name}.tex`), String.raw`\documentclass{article}
\usepackage[a4paper,landscape]{geometry}
\usepackage{pdfpages}
\begin{document}
\includepdf[pages=-,${sig ? `signature=${sig}` : "booklet"}]{${a5}}
\end{document}
`);
    await run(lualatex(name));
    for (const ext of ["aux", "log", "tex"]) rmSync(join(outDir, `${name}.${ext}`), { force: true });
    rmSync(join(outDir, a5));
    console.log(`pdf   ${join(outDir, `${name}.pdf`)}  (A4 landscape, print double-sided, flip on short edge)`);
  }
}
