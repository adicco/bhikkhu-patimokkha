/**
 * The distribution page: dist/site/index.html, generated from the release manifest.
 * Its custom-build form posts to /api/build and its preview to /api/preview (src/serve.ts);
 * opened without the server, the downloads still work and the form explains what's missing.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FORMATS, hashedName, hashFile, LANGS } from "./artifacts";
import { uposathaDays } from "./calendar";
import { loadChapters } from "./load";
import { NUMBERS, SEASON_TABLES } from "./occasion";
import { CEREMONIES, previewHtml } from "./preview";
import type { Manifest } from "./release";

const ASSETS = join(import.meta.dir, "..", "assets");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function size(bytes: number) {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** Gentium Plus regular and italic, subset to what Pāli and English need, as WOFF2 when Python fontTools is installed. */
async function fonts(out: string) {
  rmSync(join(out, "fonts"), { recursive: true, force: true });
  mkdirSync(join(out, "fonts"), { recursive: true });
  const faces: Record<string, string> = {};
  const listed = Bun.spawnSync(["fc-list", ":family=Gentium Plus", "file"]).stdout.toString();
  for (const style of ["Regular", "Italic"]) {
    const src = listed.split("\n").map((l) => l.replace(/:\s*$/, "").trim()).find((f) => f.endsWith(`GentiumPlus-${style}.ttf`));
    if (!src) throw new Error(`Gentium Plus ${style} not found by fc-list`);
    const tmp = join(out, "fonts", `GentiumPlus-${style}.woff2`);
    let ok = false;
    try {
      ok = Bun.spawnSync(["python3", "-m", "fontTools.subset", src, `--output-file=${tmp}`, "--flavor=woff2",
        "--unicodes=U+0000-00FF,U+0100-017F,U+0300-036F,U+1E00-1EFF,U+2000-206F,U+2190-2193,U+2212,U+2264-2265",
        "--layout-features=kern,liga,onum,lnum,smcp,c2sc", "--no-hinting"], { stderr: "ignore" }).exitCode === 0;
    } catch {}
    const file = ok ? tmp : join(out, "fonts", `GentiumPlus-${style}.ttf`);
    if (!ok) {
      console.warn("fontTools (with brotli) not available; serving the full TTF");
      copyFileSync(src, file);
    }
    const name = hashedName(file, (await hashFile(file)).short);
    copyFileSync(file, join(out, "fonts", name));
    rmSync(file);
    faces[style] = `fonts/${name}`;
  }
  return faces;
}

/** `today` (YYYY-MM-DD) fixes the calendar range the page embeds; the e2e tests pin it. */
export async function writeSite(out: string, manifest: Manifest, opts: { today?: string } = {}) {
  const faces = await fonts(out);
  const chapters = loadChapters().map((c) => ({ slug: c.slug, title: c.title, notes: c.kind === "notes" }));

  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const until = `${Number(today.slice(0, 4)) + 6}${today.slice(4)}`;
  const data = {
    chapters,
    ceremonies: CEREMONIES,
    numbers: [...NUMBERS].map(([n, forms]) => [n, forms]),
    seasons: SEASON_TABLES.map((t) => ({ title: t.title, length: t.entries.length, pavarana: t.entries.indexOf(null) + 1 || null })),
    days: uposathaDays().filter((d) => d.date >= `${Number(today.slice(0, 4)) - 1}${today.slice(4)}` && d.date <= until),
  };

  // The downloads table: one row per language, one column per format.
  const cell = (lang: string, kind: string) => {
    const f = manifest.files.find((x) => x.lang === lang && x.kind === kind);
    const label = FORMATS.find((x) => x.kind === kind)!.label;
    if (!f) return `<td class="none" data-label="${label}">not built</td>`;
    const langLabel = LANGS.find((x) => x.lang === lang)!.label;
    return `<td data-label="${label}"><a href="${esc(f.file)}" download aria-label="${esc(`${langLabel}, ${label}, ${size(f.bytes)}`)}">${size(f.bytes)}</a></td>`;
  };
  const table = `<table class="downloads">
  <thead><tr><td></td>${FORMATS.map((f) => `<th scope="col">${f.label}</th>`).join("")}</tr></thead>
  <tbody>
${LANGS.map((l) => `    <tr><th scope="row">${l.label}</th>${FORMATS.map((f) => cell(l.lang, f.kind)).join("")}</tr>`).join("\n")}
  </tbody>
</table>`;

  const css = readFileSync(join(ASSETS, "site.css"), "utf8")
    .replace("url(REGULAR)", `url(${faces.Regular})`)
    .replace("url(ITALIC)", `url(${faces.Italic})`);
  const js = readFileSync(join(ASSETS, "site.js"), "utf8");
  const template = readFileSync(join(ASSETS, "site.html"), "utf8");

  const html = template
    .replace("/*CSS*/", () => css)
    .replace("/*JS*/", () => js)
    .replace("<!--DOWNLOADS-->", () => table)
    .replace("<!--RELEASED-->", () => `<a href="https://github.com/adicco/bhikkhu-patimokkha/releases">Source text v${esc(manifest.edition)}</a>.`)
    .replace("<!--PREVIEW-->", () => previewHtml("uposatha", {}, "both"))
    .replace("/*DATA*/", () => JSON.stringify(data).replace(/</g, "\\u003c"));
  writeFileSync(join(out, "index.html"), html);
}

if (import.meta.main) {
  // Regenerate the page alone from an existing manifest: bun src/site.ts [dist/site]
  const out = Bun.argv[2] ?? join("dist", "site");
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as Manifest;
  await writeSite(out, manifest);
  console.log(`index ${join(out, "index.html")}`);
}
