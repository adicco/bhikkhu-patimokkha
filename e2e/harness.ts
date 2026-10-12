/**
 * End-to-end harness: a site generated for a fixed date, the real server on a free port, and a
 * headless Chromium (playwright-core; `bunx playwright-core install chromium-headless-shell` once,
 * or set CHROMIUM_PATH).
 *
 * The downloads table is built from small stand-in files (real names, hashes and manifest), so
 * the page tests don't need a full LaTeX release; e2e/builds.e2e.test.ts runs real builds.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { baseName, combinedHash, FORMATS, hashedName, LANGS } from "../src/artifacts";
import type { Manifest, ManifestFile } from "../src/release";
import { writeSite } from "../src/site";

const ROOT = join(import.meta.dir, "..");

/** The page and the browser clock agree on this date: the next observance is the Pavāraṇā of 26 October. */
export const TODAY = "2026-10-12";

export interface Site {
  url: string;
  dir: string;
  manifest: Manifest;
  stop(): Promise<void>;
}

export async function startSite(): Promise<Site> {
  const dir = mkdtempSync(join(tmpdir(), "patimokkha-e2e-"));
  const site = join(dir, "site");
  mkdirSync(join(site, "files"), { recursive: true });

  const files: ManifestFile[] = [];
  for (const { lang } of LANGS) {
    const stand = FORMATS.map((f) => {
      const body = `stand-in for ${lang} ${f.kind}\n`;
      return { f, body, sha256: new Bun.CryptoHasher("sha256").update(body).digest("hex") };
    });
    const hash = combinedHash(stand.map((s) => s.sha256));
    for (const { f, body, sha256 } of stand) {
      const name = hashedName(f.built(baseName(lang)), hash);
      writeFileSync(join(site, "files", name), body);
      files.push({ lang, kind: f.kind, file: `files/${name}`, bytes: body.length, sha256 });
    }
  }
  const manifest: Manifest = { generated: `${TODAY}T00:00:00Z`, commit: "e2e", sourceDate: `${TODAY}T00:00:00Z`, files };
  writeFileSync(join(site, "manifest.json"), JSON.stringify(manifest));
  await writeSite(site, manifest, { today: TODAY });

  const server = Bun.spawn(["bun", "src/serve.ts"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", SITE_DIR: site, CACHE_DIR: join(dir, "cache"), BUILD_CONCURRENCY: "2" },
    stdout: "pipe",
    stderr: "inherit",
  });
  const url = await new Promise<string>(async (resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 15_000);
    const decoder = new TextDecoder();
    let seen = "";
    for await (const chunk of server.stdout) {
      seen += decoder.decode(chunk);
      const m = seen.match(/on (http:\/\/[^\s]+)/);
      if (m) { clearTimeout(timer); resolve(m[1]!.replace("0.0.0.0", "127.0.0.1") + "/"); break; }
    }
  });

  return {
    url,
    dir,
    manifest,
    async stop() {
      server.kill();
      await server.exited;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const launch = (): Promise<Browser> =>
  chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

export interface Opened { page: Page; errors: string[]; close(): Promise<void> }

/** Open the page with the clock fixed at `date` and wait until the server has answered. */
export async function open(browser: Browser, site: Site, opts: { date?: string; width?: number; offline?: boolean } = {}): Promise<Opened> {
  const context = await browser.newContext({ viewport: { width: opts.width ?? 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !opts.offline) errors.push(m.text()); });
  await page.clock.setFixedTime(new Date(`${opts.date ?? TODAY}T09:00:00`));
  if (opts.offline) await page.route("**/api/**", (r) => r.abort());
  const ready = opts.offline ? Promise.resolve() : page.waitForResponse((r) => r.url().endsWith("/api/preview"));
  await page.goto(site.url);
  await ready;
  return { page, errors, close: () => context.close() };
}

/** Do something to the form and wait for the preview it causes. */
export async function change(page: Page, action: () => Promise<unknown>) {
  const answered = page.waitForResponse((r) => r.url().endsWith("/api/preview"));
  await action();
  await answered;
  await page.waitForFunction(() => !document.querySelector("#preview")?.getAttribute("aria-busy"));
}

/** The form's values, as the page's own script reads them. */
export function formState(page: Page) {
  return page.evaluate(() => {
    const f = document.getElementById("custom") as HTMLFormElement;
    const v = (n: string) => {
      const e = f.elements.namedItem(n) as any;
      if (!e) return undefined;
      return e instanceof RadioNodeList ? e.value : e.type === "checkbox" ? e.checked : e.value;
    };
    return {
      date: v("date"), ceremony: v("ceremony"), season: v("season"), adhika: v("adhika"),
      fortnight: v("fortnight"), day: v("day"), bhikkhus: v("bhikkhus"), address: v("address"),
      time: v("time"), helpers: v("helpers"), statements: v("statements"),
      lang: v("lang"), target: v("target"), paper: v("paper"), size: v("size"),
    };
  });
}

/** The preview's text, one line per line as set (whitespace collapsed within a line). */
export async function previewText(page: Page) {
  const text = await page.locator("#preview").innerText();
  return text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

export const checkedChapters = (page: Page) =>
  page.$$eval('input[name="chapter"]:checked', (bs) => bs.map((b) => (b as HTMLInputElement).value));

/** Whether a form control (or, for radios, the first of the group) is shown. */
export const shown = (page: Page, selector: string) => page.locator(selector).first().isVisible();

/** Run a build from the form and return the downloaded file's name and path. */
export async function buildFromForm(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 170_000 }),
    page.click("#build"),
  ]);
  const path = await download.path();
  return { name: download.suggestedFilename(), path: path!, status: await page.locator("#status").textContent() };
}
