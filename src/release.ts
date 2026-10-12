#!/usr/bin/env bun
/**
 * bun run release [--skip-build] [--out dist/site] [--dist dist]   (--help for details)
 *
 * Builds every standard file (three languages × A4, A5, A5 booklet, EPUB, HTML, Markdown zip),
 * copies each into <out>/files/ under a name that carries a content hash shared by all of a
 * language's formats (Bhikkhu-Patimokkha.Pali.A4.3f9c2a1e0b.pdf, …Pali.3f9c2a1e0b.epub), writes <out>/manifest.json and generates
 * <out>/index.html linking to those names. Hashed files can be cached forever; only
 * index.html and manifest.json change from one release to the next.
 *
 * Builds are reproducible: SOURCE_DATE_EPOCH defaults to the last commit's time, so unchanged
 * text keeps its file names (and its readers' caches) across releases.
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCli } from "./cli";
import { baseName, combinedHash, FORMATS, hashedName, hashFile, LANGS, zipMarkdown, type Kind } from "./artifacts";
import { writeSite } from "./site";
import type { Lang } from "./options";

const ROOT = join(import.meta.dir, "..");
const HELP = `
Usage: bun run release [options]

Builds every standard file and writes a content-hashed release site.

  --skip-build    reuse the files already in --dist instead of rebuilding
  --out DIR       where to write the site (default: dist/site)
  --dist DIR      where the builds go (default: dist)
  -h, --help      show this help
`;
const { values } = parseCli("src/release.ts", HELP, {
  "skip-build": { type: "boolean", default: false },
  out: { type: "string", default: join("dist", "site") },
  dist: { type: "string", default: "dist" },
});
const out = join(ROOT, values.out!);
const dist = join(ROOT, values.dist!);

/** A command's output, or "" when it fails or isn't installed (e.g. git inside the Docker image). */
function sh(cmd: string[]) {
  try {
    const p = Bun.spawnSync(cmd, { cwd: ROOT, stderr: "ignore" });
    return p.exitCode === 0 ? p.stdout.toString().trim() : "";
  } catch {
    return "";
  }
}

const epoch = process.env.SOURCE_DATE_EPOCH || sh(["git", "log", "-1", "--format=%ct"]) || String(Math.floor(Date.now() / 1000));
const commit = process.env.GIT_COMMIT || sh(["git", "rev-parse", "--short", "HEAD"]) || undefined;
const env = { ...process.env, SOURCE_DATE_EPOCH: epoch, FORCE_SOURCE_DATE: "1" };

if (!values["skip-build"]) {
  for (const { lang } of LANGS) {
    console.log(`\n== ${lang}`);
    const p = Bun.spawn(["bun", "src/build.ts", "all", "--lang", lang, "--paper", "a4,a5,booklet", "--out", dist],
      { cwd: ROOT, env, stdout: "inherit", stderr: "inherit" });
    if ((await p.exited) !== 0) process.exit(1);
  }
}

export interface ManifestFile { lang: Lang; kind: Kind; file: string; bytes: number; sha256: string }
export interface Manifest { generated: string; commit?: string; sourceDate: string; files: ManifestFile[] }

rmSync(join(out, "files"), { recursive: true, force: true });
mkdirSync(join(out, "files"), { recursive: true });

const files: ManifestFile[] = [];
for (const { lang } of LANGS) {
  const dir = join(dist, lang);
  const base = baseName(lang);
  const built: { kind: Kind; path: string; sha256: string }[] = [];
  for (const f of FORMATS) {
    let path = join(dir, f.built(base));
    if (f.kind === "md") path = await zipMarkdown(dir, base, Number(epoch));
    try { statSync(path); } catch { console.warn(`missing ${path}; not listed`); continue; }
    built.push({ kind: f.kind, path, sha256: (await hashFile(path)).sha256 });
  }
  const hash = combinedHash(built.map((b) => b.sha256));
  for (const { kind, path, sha256 } of built) {
    const name = hashedName(path, hash);
    copyFileSync(path, join(out, "files", name));
    files.push({ lang, kind, file: `files/${name}`, bytes: statSync(path).size, sha256 });
  }
}

const manifest: Manifest = {
  generated: new Date().toISOString(),
  commit,
  sourceDate: new Date(Number(epoch) * 1000).toISOString(),
  files,
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await writeSite(out, manifest);

console.log(`\n${files.length} files in ${join(values.out!, "files")}:`);
for (const f of readdirSync(join(out, "files")).sort()) console.log(`  ${f}`);
console.log(`index ${join(values.out!, "index.html")}`);
