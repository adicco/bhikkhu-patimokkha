/** The files a build produces, and how releases name them by content. */
import { readdirSync, utimesSync } from "node:fs";
import { basename, join } from "node:path";
import type { Lang } from "./options";

export const LANGS: { lang: Lang; label: string; suffix: string }[] = [
  { lang: "both", label: "Pāli and English", suffix: "Pali-English" },
  { lang: "pali", label: "Pāli", suffix: "Pali" },
  { lang: "english", label: "English", suffix: "English" },
];

export type Kind = "a4" | "a5" | "booklet" | "epub" | "html" | "md";

export const FORMATS: { kind: Kind; label: string; target: "pdf" | "epub" | "html" | "md"; built: (base: string) => string }[] = [
  { kind: "a4", label: "A4 PDF", target: "pdf", built: (b) => `${b}.A4.pdf` },
  { kind: "a5", label: "A5 PDF", target: "pdf", built: (b) => `${b}.A5.pdf` },
  { kind: "booklet", label: "A5 booklet", target: "pdf", built: (b) => `${b}.A5-booklet.pdf` },
  { kind: "epub", label: "EPUB", target: "epub", built: (b) => `${b}.epub` },
  { kind: "html", label: "HTML", target: "html", built: (b) => `${b}.html` },
  { kind: "md", label: "Markdown", target: "md", built: (b) => `${b}.Markdown.zip` },
];

export const baseName = (lang: Lang) => `Bhikkhu-Patimokkha.${LANGS.find((l) => l.lang === lang)!.suffix}`;

/** The first 10 hex digits of the file's SHA-256, and the whole digest. */
export async function hashFile(path: string) {
  const sha256 = new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
  return { short: sha256.slice(0, 10), sha256 };
}

/**
 * One short hash for a set of files (a language's formats), from their SHA-256 digests in order,
 * so the files share a name stem yet any change to any of them still changes it.
 */
export function combinedHash(sha256s: string[]) {
  return new Bun.CryptoHasher("sha256").update(sha256s.join("\n")).digest("hex").slice(0, 10);
}

/** "x.A4.pdf" + hash → "x.A4.<hash>.pdf" */
export function hashedName(file: string, hash: string) {
  const name = basename(file);
  const dot = name.lastIndexOf(".");
  return `${name.slice(0, dot)}.${hash}${name.slice(dot)}`;
}

/**
 * Zip a markdown build (the combined file and the per-chapter files in md/) as `${base}.Markdown.zip`.
 * Entries are added in sorted order with a fixed timestamp, so the same text gives the same zip.
 */
export async function zipMarkdown(outDir: string, base: string, epoch = Number(process.env.SOURCE_DATE_EPOCH ?? 315532800)) {
  const files = [`${base}.md`, ...readdirSync(join(outDir, "md")).filter((f) => f.endsWith(".md")).sort().map((f) => `md/${f}`)];
  const t = new Date(epoch * 1000);
  for (const f of [...files, "md"]) utimesSync(join(outDir, f), t, t);
  const zip = `${base}.Markdown.zip`;
  await Bun.file(join(outDir, zip)).delete().catch(() => {});
  const p = Bun.spawn(["zip", "-X", "-q", "-D", zip, ...files], { cwd: outDir, env: { ...process.env, TZ: "UTC" }, stderr: "pipe" });
  if ((await p.exited) !== 0) throw new Error(`zip failed: ${await new Response(p.stderr).text()}`);
  return join(outDir, zip);
}
