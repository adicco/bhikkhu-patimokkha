#!/usr/bin/env bun
/**
 * bun run publish [--skip-build] [--notes FILE] [--tag vYYYY.MM.DD.N] [--draft] [--force] [--dry-run]   (--help for details)
 *
 * Publishes the release files (dist/site/files/, from `bun run release`) and manifest.json as a
 * GitHub release on the commit they were built from. The notes open with what changed: --notes FILE
 * if given, else the "## Unreleased" section of CHANGELOG.md, else the commit messages since the
 * last release. A downloads table follows. After publishing, the Unreleased heading becomes the
 * release's tag and date (with a fresh empty Unreleased above it), committed and pushed.
 * Needs the gh CLI, logged in. The tag defaults to the text's date and that day's release number
 * (v2026.10.12.1, v2026.10.12.2, …), counting on from CHANGELOG.md's headings, the releases and the
 * tags. If the latest release already has exactly these files, nothing is published unless
 * --force: the hashed names change only when the text does.
 * The release is made as a draft, the files uploaded one by one, then the draft published; each
 * GitHub call is retried on 5xx/network errors and traced to dist/publish.log (GH_DEBUG=api,
 * token redacted). If a run still fails, the draft stays: rerun with --skip-build to resume it.
 */
import { readFileSync, statSync, writeFileSync, appendFileSync, mkdtempSync, rmSync } from "node:fs";
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
  --tag TAG       the release tag (default: v<YYYY.MM.DD>.N of the text's date, N counting
                  that day's releases from 1)
  --draft         create the release as a draft
  --force         publish even if the latest release has the same files
  -y, --yes       use the commit messages as the notes without asking, when there is no
                  --notes and CHANGELOG.md's Unreleased section is empty
  --dry-run       show what would be published, and publish nothing
  -h, --help      show this help

GitHub calls are retried on server/network errors and traced to dist/publish.log. A run that
still fails leaves a draft release; rerun with --skip-build to resume it.
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
const releases: { tagName: string; isLatest: boolean; isDraft: boolean }[] = JSON.parse(run(["gh", "release", "list", "--limit", "100", "--json", "tagName,isLatest,isDraft"])!);
/** Tags taken by a published release; a draft's tag is free, and its draft is resumed. */
const taken = (tag: string) => releases.some((r) => r.tagName === tag && !r.isDraft);

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
// Default tag v<date>.N, numbering a day's releases from .1: N is one past the highest number that
// day already has in a CHANGELOG.md heading, a published release or a git tag (a bare v<date>
// counts as .0). A draft's tag isn't counted, so its draft is resumed.
const day = `v${date.replace(/-/g, ".")}`;
const numberOf = (t: string) => (t === day ? 0 : t.startsWith(`${day}.`) && /^\d+$/.test(t.slice(day.length + 1)) ? Number(t.slice(day.length + 1)) : -1);
const used = [
  ...[...(changelog ?? "").matchAll(/^## (v\S+)/gm)].map((m) => m[1]!),
  ...releases.filter((r) => !r.isDraft).map((r) => r.tagName),
  ...(run(["git", "tag", "--list", `${day}*`]) ?? "").split("\n"),
].map(numberOf);
let tag = values.tag ?? `${day}.${Math.max(0, ...used) + 1}`;
if (values.tag && taken(tag)) fail(`a release tagged ${tag} already exists`);
const resuming = releases.some((r) => r.tagName === tag && r.isDraft);

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

console.log(`${dry ? "Would publish" : "Publishing"} ${tag} on ${head.slice(0, 7)} to ${repo}${values.draft ? " (draft)" : ""}${resuming ? ", resuming its draft" : ""}:`);
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

// ---- Upload: draft, then each file, then publish, so a failure can be retried or resumed.

const LOG = join(ROOT, "dist", "publish.log");
writeFileSync(LOG, `publish ${tag} on ${head} to ${repo}, ${new Date().toISOString()}\n`);
const elapsed = (t0: number) => `${((performance.now() - t0) / 1000).toFixed(1)}s`;

/** A failed gh call: what GitHub said, and whether trying again might help (5xx or no response). */
class GhError extends Error {
  constructor(message: string, readonly transient: boolean) { super(message); }
}

/** Run gh once with its API trace (GH_DEBUG=api, token redacted) appended to LOG; its stdout. */
async function ghOnce(what: string, args: string[], attempt: number): Promise<string> {
  const t0 = performance.now();
  appendFileSync(LOG, `\n==== ${what}, attempt ${attempt}: gh ${args.join(" ")}\n`);
  const p = Bun.spawn(["gh", ...args], { cwd: ROOT, env: { ...process.env, GH_DEBUG: "api" }, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  appendFileSync(LOG, `${err}\n==== exit ${code} after ${elapsed(t0)}\n`);
  if (code === 0) return out.trim();
  // gh's own message comes last, after the trace (lines starting "* ", "> ", "< ", bodies, GraphQL).
  const status = [...err.matchAll(/^< HTTP\/[\d.]+ (\d{3}.*)$/gm)].at(-1)?.[1];
  const id = [...err.matchAll(/^< X-Github-Request-Id: (\S+)/gim)].at(-1)?.[1];
  const message = err.split("\n").filter((l) => /^[^\s*<>{}\[\]"]/.test(l) && !/^GraphQL |accessibility/i.test(l)).at(-1) || `gh exited ${code}`;
  const http = !status ? "no HTTP response" : /^2/.test(status) ? "" : `HTTP ${status}`;
  throw new GhError(`${[http, id && `request ${id}`, `after ${elapsed(t0)}`].filter(Boolean).join(", ")}: ${message}`,
    !status || status.startsWith("5"));
}

function giveUp(what: string, e: unknown): never {
  fail(`${what} failed (${e instanceof Error ? e.message : e})\nFull API trace: ${LOG}\n` +
    `The draft release ${tag}, if made, is kept: rerun with --skip-build to resume it, or delete it with\n  gh release delete ${tag} --yes`);
}

/**
 * Run gh, retrying transient failures with backoff (2s, 4s, 8s). Before each retry, `done` (if
 * given) is asked whether the failed call took effect anyway: GitHub can answer 500 and still act.
 */
async function gh(what: string, args: string[], done?: () => Promise<boolean>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await ghOnce(what, args, attempt);
      return;
    } catch (e) {
      if (!(e instanceof GhError) || !e.transient || attempt >= 4) giveUp(what, e);
      const wait = 2 ** attempt;
      console.warn(`    ${what}: ${e.message}; retrying in ${wait}s`);
      await Bun.sleep(wait * 1000);
      if (done && (await done())) {
        console.warn(`    ${what}: it went through after all`);
        return;
      }
    }
  }
}

/** Read-only gh call, retried; its stdout. */
async function ghRead(what: string, args: string[]): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await ghOnce(what, args, attempt);
    } catch (e) {
      if (!(e instanceof GhError) || !e.transient || attempt >= 4) giveUp(what, e);
      console.warn(`    ${what}: ${e.message}; retrying in ${2 ** attempt}s`);
      await Bun.sleep(2 ** attempt * 1000);
    }
  }
}

type Asset = { name: string; size: number; state: string };
const draftExists = async () =>
  (JSON.parse(await ghRead("listing releases", ["release", "list", "--limit", "100", "--json", "tagName,isDraft"])) as { tagName: string; isDraft: boolean }[])
    .some((r) => r.tagName === tag && r.isDraft);
const uploaded = async () =>
  (JSON.parse(await ghRead("listing the draft's files", ["release", "view", tag, "--json", "assets", "--jq", ".assets"])) as Asset[])
    .filter((a) => a.state === "uploaded");
const sizeOf = (path: string) => statSync(path).size;

const tmp = mkdtempSync(join(tmpdir(), "patimokkha-publish-"));
try {
  writeFileSync(join(tmp, "notes.md"), notes);
  const meta = ["--target", head, "--title", `Bhikkhu Pāṭimokkha, ${released}`, "--notes-file", join(tmp, "notes.md")];
  const t0 = performance.now();
  if (resuming || (await draftExists())) {
    await gh("updating the draft", ["release", "edit", tag, ...meta]);
    console.log(`  draft ${tag} updated (${elapsed(t0)})`);
  } else {
    await gh("creating the draft", ["release", "create", tag, "--draft", ...meta], draftExists);
    console.log(`  draft ${tag} created (${elapsed(t0)})`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// Files already on the draft with the right size (from a resumed run) are skipped.
const have = new Map((await uploaded()).map((a) => [a.name, a.size]));
for (const [n, path] of assets.entries()) {
  const name = path.split("/").pop()!;
  const label = `  [${n + 1}/${assets.length}] ${name} (${size(sizeOf(path))})`;
  if (have.get(name) === sizeOf(path)) {
    console.log(`${label} already there`);
    continue;
  }
  const t0 = performance.now();
  await gh(`uploading ${name}`, ["release", "upload", tag, path, "--clobber"],
    async () => (await uploaded()).some((a) => a.name === name && a.size === sizeOf(path)));
  console.log(`${label} ${elapsed(t0)}`);
}

// Every file there, whole, and nothing else (but stray files from an older run of this draft).
const there = new Map((await uploaded()).map((a) => [a.name, a.size]));
const missing = assets.filter((p) => there.get(p.split("/").pop()!) !== sizeOf(p)).map((p) => p.split("/").pop());
if (missing.length) fail(`after uploading, the draft ${tag} is missing or has short copies of: ${missing.join(", ")}\nFull API trace: ${LOG}\nRerun with --skip-build to resume.`);
const stray = [...there.keys()].filter((n) => !names(assets).includes(n));
for (const n of stray) await gh(`deleting stray ${n}`, ["release", "delete-asset", tag, n, "--yes"]);

if (!values.draft) {
  const t0 = performance.now();
  const published = async () => !(await draftExists());
  await gh("publishing the draft", ["release", "edit", tag, "--draft=false"], published);
  console.log(`  published (${elapsed(t0)}): https://github.com/${repo}/releases/tag/${tag}`);
} else console.log(`  left as a draft: https://github.com/${repo}/releases`);

// ---- Roll the changelog: Unreleased becomes this release.

if (changelog !== undefined && unreleased && !values.notes) {
  writeFileSync(CHANGELOG, changelog.replace(UNRELEASED, (_m, body: string) => `## Unreleased\n\n## ${tag} (${released})\n${body}`));
  run(["git", "commit", "--quiet", "-m", `Release ${tag}`, "--", "CHANGELOG.md"]);
  if (run(["git", "push", "--quiet", "origin", "HEAD"], { ok: true }) === undefined) {
    console.warn(`CHANGELOG.md committed (Release ${tag}) but not pushed; push it before the next publish`);
  } else console.log(`CHANGELOG.md: Unreleased → ${tag}, committed and pushed`);
}
