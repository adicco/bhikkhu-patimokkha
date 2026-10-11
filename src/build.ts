#!/usr/bin/env bun
/**
 * bun run build [targets…] [--lang pali|english|both] [--paper a4|a5] [--size 11]
 *               [--notes|--no-notes] [--instructions|--no-instructions] [--corrections]
 *
 * targets: md html epub pdf all   (default: all)
 * Outputs go to dist/<lang>/.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadChapters, render, validate } from "./load";
import { showFor, type Lang } from "./options";
import { toMarkdown } from "./writers/markdown";
import { toHtml } from "./writers/html";
import { toLatex } from "./writers/latex";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    lang: { type: "string", default: "both" },
    paper: { type: "string" },
    size: { type: "string" },
    notes: { type: "boolean" },
    "no-notes": { type: "boolean" },
    instructions: { type: "boolean" },
    "no-instructions": { type: "boolean" },
    corrections: { type: "boolean", default: false },
    out: { type: "string", default: "dist" },
  },
});

const lang = values.lang as Lang;
if (!["pali", "english", "both"].includes(lang)) throw new Error(`--lang must be pali, english or both`);
const targets = new Set(positionals.length && !positionals.includes("all") ? positionals : ["md", "html", "epub", "pdf"]);

const flag = (on?: boolean, off?: boolean) => (on ? true : off ? false : undefined);
const overrides = Object.fromEntries(Object.entries({
  notes: flag(values.notes, values["no-notes"]),
  instructions: flag(values.instructions, values["no-instructions"]),
  corrections: values.corrections,
}).filter(([, v]) => v !== undefined));
const show = showFor(lang, overrides);

const chapters = loadChapters();
const errors = validate(chapters);
if (errors.length) {
  for (const e of errors) console.error(`${e.file}:${e.line ?? "?"} ${e.level} ${e.id}: ${e.message}`);
  if (errors.some((e) => e.level === "error" || e.level === "critical")) process.exit(1);
}

const rendered = render(chapters, show);
const suffix = { pali: "Pali", english: "English", both: "Pali-English" }[lang];
const title = `Bhikkhu Pāṭimokkha (${{ pali: "Pāli", english: "English", both: "Pāli–English" }[lang]})`;
const base = `Bhikkhu-Patimokkha.${suffix}`;
const outDir = join(values.out!, lang);
mkdirSync(outDir, { recursive: true });

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
  writeFileSync(epubHtml, toHtml(rendered, show, { title, standalone: false, embedCss: false }));
  await run([
    "pandoc", `.${base}.epub.html`, "-f", "html", "-o", `${base}.epub`,
    "--css", css, "--split-level=2", "--toc", "--toc-depth=2",
    "--metadata", `title=${title}`, "--metadata", "author=Ṭhānissaro Bhikkhu (tr.)",
    "--metadata", `lang=${show.pali && !show.english ? "pi" : "en"}`,
    ...["Regular", "Italic", "Bold", "BoldItalic"].map((s) => `--epub-embed-font=/usr/share/fonts/TTF/GentiumPlus-${s}.ttf`),
  ]);
  rmSync(epubHtml);
  console.log(`epub  ${join(outDir, `${base}.epub`)}`);
}

if (targets.has("pdf")) {
  const paper = (values.paper ?? (lang === "both" ? "a4" : "a5")) as "a4" | "a5";
  const fontSize = Number(values.size ?? (lang === "pali" ? 12 : 11));
  writeFileSync(join(outDir, `${base}.tex`), toLatex(rendered, show, { title, paper, fontSize }));
  for (let i = 0; i < 2; i++) await run(["lualatex", "-interaction=nonstopmode", "-halt-on-error", `${base}.tex`]);
  for (const ext of ["aux", "log", "out", "toc"]) rmSync(join(outDir, `${base}.${ext}`), { force: true });
  console.log(`pdf   ${join(outDir, `${base}.pdf`)}`);
}
