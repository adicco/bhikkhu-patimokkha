#!/usr/bin/env bun
/**
 * bun run publish [--skip-build] [--notes FILE] [--tag vYYYY.MM.DD] [--draft] [--force] [--dry-run]   (--help for details)
 *
 * Publishes the release files (dist/site/files/, from `bun run release`) and manifest.json as a
 * GitHub release on the commit they were built from. The notes open with what changed: --notes FILE
 * if given, else the "## Unreleased" section of CHANGELOG.md, else the commit messages since the
 * last release. A downloads table follows. After publishing, the Unreleased heading becomes the
 * release's tag and date (with a fresh empty Unreleased above it), committed and pushed.
 * Needs the gh CLI, logged in. The tag defaults to the text's date (v2026.10.12, then
 * v2026.10.12.2, … if that is taken). If the latest release already has exactly these files,
 * nothing is published unless --force: the hashed names change only when the text does.
 */
import { readFileSync, statSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCli } from "./cli";
import { FORMATS, LANGS } from "./artifacts";
import type { Manifest } from "./release";

const ROOT = join(import.meta.dir, "..");
const NAME = "src/publish.ts";
const HELP = `
Usage: bun run publish [options]

Builds the release (bun run release) and publishes its files as a GitHub release.

  --skip-build    publish the files already in --site instead of rebuilding
  --site DIR      the release site to publish (default: dist/site)
  --notes FILE    what changed, in Markdown (default: CHANGELOG.md's Unreleased section,
                  or the commit messages since the last release)
  --tag TAG       the release tag (default: v<YYYY.MM.DD> of the text's date)
  --draft         create the release as a draft
  --force         publish even if the latest release has the same files
  -y, --yes       use the commit messages as the notes without asking, when there is no
                  --notes and CHANGELOG.md's Unreleased section is empty
  --dry-run       show what would be published, and publish nothing
  -h, --help      show this help
`;
const { values } = parseCli(NAME, HELP, {
  "skip-build": { type: "boolean", default: false },
  site: { type: "string", default: join("dist", "site") },
  notes: { type: "string" },
  tag: { type: "string" },
  draft: { type: "boolean", default: false },
  force: { type: "boolean", default: false },
  yes: { type: "boolean", short: "y", default: false },
  "dry-run": { type: "boolean", default: false },
});
const site = join(ROOT, values.site!);
const dry = values["dry-run"]!;

function fail(message: string): never {
  console.error(`${NAME}: ${message}`);
  process.exit(1);
}

/** Run a command; its trimmed stdout, or a failure with its stderr. */
function run(cmd: string[], opts: { ok?: boolean } = {}) {
  const p = Bun.spawnSync(cmd, { cwd: ROOT, stderr: "pipe" });
  if (p.exitCode !== 0) {
    if (opts.ok) return undefined;
    fail(`${cmd.slice(0, 3).join(" ")} failed: ${p.stderr.toString().trim()}`);
  }
  return p.stdout.toString().trim();
}

// ---- The commit: the files must be built from a clean, pushed HEAD, so the tag points at their source.

if (run(["git", "status", "--porcelain"])) fail("the working tree has uncommitted changes; commit them first");
const head = run(["git", "rev-parse", "HEAD"])!;
run(["git", "fetch", "--quiet", "--tags", "origin"]);
if (!run(["git", "branch", "-r", "--contains", head])) fail(`HEAD (${head.slice(0, 7)}) is not on origin; push it first`);

if (!values["skip-build"]) {
  const p = Bun.spawn(["bun", "src/release.ts", "--out", values.site!], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if ((await p.exited) !== 0) process.exit(1);
}

let manifest: Manifest;
try {
  manifest = JSON.parse(readFileSync(join(site, "manifest.json"), "utf8"));
} catch {
  fail(`no ${join(values.site!, "manifest.json")}; run without --skip-build`);
}
if (!manifest.commit || !head.startsWith(manifest.commit)) {
  fail(`the files in ${values.site} were built from ${manifest.commit ?? "an unknown commit"}, not HEAD (${head.slice(0, 7)}); run without --skip-build`);
}
for (const f of manifest.files) if (statSync(join(site, f.file)).size === 0) fail(`${f.file} is empty; rebuild without --skip-build`);
let intro = "";
if (values.notes) {
  try { intro = readFileSync(values.notes, "utf8").trim(); } catch { fail(`can't read --notes ${values.notes}`); }
}
const assets = [...manifest.files.map((f) => join(site, f.file)), join(site, "manifest.json")];
const names = (paths: string[]) => paths.map((p) => p.split("/").pop()!).sort();

// ---- The release.

const repo = run(["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])!;
const releases: { tagName: string; isLatest: boolean }[] = JSON.parse(run(["gh", "release", "list", "--limit", "100", "--json", "tagName,isLatest"])!);

const latest = releases.find((r) => r.isLatest);
if (latest && !values.force) {
  const published: string[] = JSON.parse(run(["gh", "release", "view", latest.tagName, "--json", "assets", "--jq", "[.assets[].name]"])!);
  const ours = names(assets).filter((n) => n !== "manifest.json");
  if (JSON.stringify(published.filter((n) => n !== "manifest.json").sort()) === JSON.stringify(ours)) {
    console.log(`${latest.tagName} already has these files; nothing to publish (--force to publish anyway)`);
    process.exit(0);
  }
}

// ---- What changed.

const CHANGELOG = join(ROOT, "CHANGELOG.md");
const UNRELEASED = /^## Unreleased[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m;
let changelog: string | undefined;
try { changelog = readFileSync(CHANGELOG, "utf8"); } catch {}
const unreleased = changelog?.match(UNRELEASED)?.[1]?.trim() ?? "";
if (!intro) intro = unreleased;
const fallback = !intro;
if (fallback) {
  const since = releases.map((r) => r.tagName).find((t) => run(["git", "rev-parse", "-q", "--verify", `refs/tags/${t}`], { ok: true }));
  const log = since
    ? run(["git", "log", "--no-merges", "--format=- %s", `${since}..HEAD`])!.split("\n").filter((l) => l && !/^- Release v/.test(l)).join("\n")
    : "";
  intro = since ? (log ? `Changes since ${since}:\n\n${log}` : "") : "First release.";
}
if (intro) intro += "\n\n";

const date = manifest.sourceDate.slice(0, 10);
let tag = values.tag ?? `v${date.replace(/-/g, ".")}`;
if (!values.tag) for (let n = 2; releases.some((r) => r.tagName === tag) || run(["git", "rev-parse", "-q", "--verify", `refs/tags/${tag}`], { ok: true }); n++) tag = `v${date.replace(/-/g, ".")}.${n}`;
else if (releases.some((r) => r.tagName === tag)) fail(`a release tagged ${tag} already exists`);

const size = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);
const released = new Date(manifest.sourceDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const url = (file: string) => `https://github.com/${repo}/releases/download/${tag}/${file.split("/").pop()}`;
const notes = `${intro}Text as of ${released} (${manifest.commit}).

| | ${FORMATS.map((f) => f.label).join(" | ")} |
|---|${FORMATS.map(() => "---").join("|")}|
${LANGS.map((l) => `| **${l.label}** | ${FORMATS.map((f) => {
  const file = manifest.files.find((x) => x.lang === l.lang && x.kind === f.kind);
  return file ? `[${size(file.bytes)}](${url(file.file)})` : "—";
}).join(" | ")} |`).join("\n")}

The A5 booklet is imposed two-up on A4 landscape: print double-sided, flip on the short edge, fold and staple.
SHA-256 digests are in \`manifest.json\`.
`;

console.log(`${dry ? "Would publish" : "Publishing"} ${tag} on ${head.slice(0, 7)} to ${repo}${values.draft ? " (draft)" : ""}:`);
for (const n of names(assets)) console.log(`  ${n}`);
if (dry) {
  console.log(`\n${notes}`);
  process.exit(0);
}
if (fallback && !values.yes) {
  console.log(`\nCHANGELOG.md's Unreleased section is empty, so the notes will open with:\n\n${intro.trim() || "(nothing)"}\n`);
  if (!process.stdin.isTTY) fail("not asking without a terminal; add notes to CHANGELOG.md, or pass --notes FILE or --yes");
  if (!/^y(es)?$/i.test(prompt("Publish with these notes? [y/N]")?.trim() ?? "")) fail("not published; add notes under ## Unreleased in CHANGELOG.md");
}

const tmp = mkdtempSync(join(tmpdir(), "patimokkha-publish-"));
try {
  writeFileSync(join(tmp, "notes.md"), notes);
  const p = Bun.spawn(["gh", "release", "create", tag, ...assets, "--target", head, "--title", `Bhikkhu Pāṭimokkha, ${released}`,
    "--notes-file", join(tmp, "notes.md"), ...(values.draft ? ["--draft"] : [])], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if ((await p.exited) !== 0) process.exit(1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ---- Roll the changelog: Unreleased becomes this release.

if (changelog !== undefined && unreleased && !values.notes) {
  writeFileSync(CHANGELOG, changelog.replace(UNRELEASED, (_m, body: string) => `## Unreleased\n\n## ${tag} (${released})\n${body}`));
  run(["git", "commit", "--quiet", "-m", `Release ${tag}`, "--", "CHANGELOG.md"]);
  if (run(["git", "push", "--quiet", "origin", "HEAD"], { ok: true }) === undefined) {
    console.warn(`CHANGELOG.md committed (Release ${tag}) but not pushed; push it before the next publish`);
  } else console.log(`CHANGELOG.md: Unreleased → ${tag}, committed and pushed`);
}
