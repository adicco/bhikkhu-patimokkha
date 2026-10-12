/** The files a build produces, and how releases name them by content. */
import { readdirSync, readFileSync, utimesSync } from "node:fs";
import { basename, join } from "node:path";
import type { Lang } from "./options";

/**
 * The version of the text (content/edition.json, kept in git). Bump it when the text changes;
 * a change of design or format changes only the files' hashes.
 */
export const EDITION: string = JSON.parse(readFileSync(join(import.meta.dir, "..", "content", "edition.json"), "utf8")).version;

export const LANGS: { lang: Lang; label: string; tag: string }[] = [
  { lang: "both", label: "Pāli and English", tag: "pali.eng" },
  { lang: "pali", label: "Pāli", tag: "pali.only" },
  { lang: "english", label: "English", tag: "eng.only" },
];

export type Kind = "a4" | "a5" | "booklet" | "epub" | "html" | "md";

/** `built` is the name of the file a build writes; releases add the hash to it (see releaseName). */
export const FORMATS: { kind: Kind; label: string; target: "pdf" | "epub" | "html" | "md"; built: (base: string) => string }[] = [
  { kind: "a4", label: "A4 PDF", target: "pdf", built: (b) => `${b}.a4.pdf` },
  { kind: "a5", label: "A5 PDF", target: "pdf", built: (b) => `${b}.a5.pdf` },
  { kind: "booklet", label: "A5 booklet", target: "pdf", built: (b) => `${b}.a5-booklet.pdf` },
  { kind: "epub", label: "EPUB", target: "epub", built: (b) => `${b}.epub` },
  { kind: "html", label: "HTML", target: "html", built: (b) => `${b}.html` },
  { kind: "md", label: "Markdown", target: "md", built: (b) => `${b}.md.zip` },
];

/** The stem of a build's files: bhikkhu-patimokkha.v1.0.pali.eng (then .a4.pdf, .epub, …). */
export const baseName = (lang: Lang, edition = EDITION) => `bhikkhu-patimokkha.v${edition}.${LANGS.find((l) => l.lang === lang)!.tag}`;

/** The first 10 hex digits of the file's SHA-256, and the whole digest. */
export async function hashFile(path: string) {
  const sha256 = new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
  return { short: sha256.slice(0, 10), sha256 };
}

/**
 * A released file's name: the build's own name with the file's hash before the extension
 * (bhikkhu-patimokkha.v1.0.pali.eng.a4.<hash>.pdf), so it follows any change to that format alone.
 * Custom builds (serve.ts) put `custom` after the languages.
 */
export function releaseName(lang: Lang, kind: Kind, hash: string, opts: { custom?: boolean; edition?: string } = {}) {
  const base = baseName(lang, opts.edition) + (opts.custom ? ".custom" : "");
  return hashedName(FORMATS.find((f) => f.kind === kind)!.built(base), hash);
}

/** "x.a4.pdf" + hash → "x.a4.<hash>.pdf" */
export function hashedName(file: string, hash: string) {
  const name = basename(file);
  const dot = name.lastIndexOf(".");
  return `${name.slice(0, dot)}.${hash}${name.slice(dot)}`;
}

/**
 * Zip a markdown build (the combined file and the per-chapter files in md/) as `${base}.md.zip`.
 * Entries are added in sorted order with a fixed timestamp, so the same text gives the same zip.
 */
export async function zipMarkdown(outDir: string, base: string, epoch = Number(process.env.SOURCE_DATE_EPOCH ?? 315532800)) {
  const files = [`${base}.md`, ...readdirSync(join(outDir, "md")).filter((f) => f.endsWith(".md")).sort().map((f) => `md/${f}`)];
  const t = new Date(epoch * 1000);
  for (const f of [...files, "md"]) utimesSync(join(outDir, f), t, t);
  const zip = `${base}.md.zip`;
  await Bun.file(join(outDir, zip)).delete().catch(() => {});
  const p = Bun.spawn(["zip", "-X", "-q", "-D", zip, ...files], { cwd: outDir, env: { ...process.env, TZ: "UTC" }, stderr: "pipe" });
  if ((await p.exited) !== 0) throw new Error(`zip failed: ${await new Response(p.stderr).text()}`);
  return join(outDir, zip);
}
