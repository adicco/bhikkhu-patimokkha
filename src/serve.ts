#!/usr/bin/env bun
/**
 * bun run serve — the distribution site and its custom builds.
 *
 *   GET  /…            dist/site (from `bun run release`); hashed files are cached for a year
 *   POST /api/preview  the passages a form selection changes, its command line and any errors
 *   POST /api/build    runs src/build.ts for a form selection and returns the file
 *   GET  /api/health
 *
 * Environment: PORT (3000), HOST (0.0.0.0), SITE_DIR (dist/site), CACHE_DIR (dist/cache),
 * BUILD_CONCURRENCY (1), BUILD_QUEUE (8), BUILD_TIMEOUT (180 s), CACHE_ENTRIES (300).
 * Builds are cached by their options and the source text, so a repeated request is instant.
 *
 * Per client address, at most BUILD_PER_IP (2) builds run or wait at once, and at most BUILD_RATE_LIMIT
 * (10; 0 turns the limit off) new builds start per BUILD_RATE_WINDOW (600 s). Cached builds don't count.
 * Behind a proxy, CLIENT_IP_HEADER names the header with the client's address (cf-connecting-ip
 * behind a Cloudflare tunnel); only set it when the proxy is the only way in, since clients can forge it.
 */
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { baseName, FORMATS, hashFile, releaseName, zipMarkdown } from "./artifacts";
import { loadChapters } from "./load";
import { OCCASION_CHOICES, occasionErrors, type Occasion } from "./occasion";
import type { Lang } from "./options";
import { CEREMONIES, previewHtml, type Ceremony } from "./preview";

const ROOT = join(import.meta.dir, "..");
const SITE = resolve(ROOT, process.env.SITE_DIR ?? "dist/site");
const CACHE = resolve(ROOT, process.env.CACHE_DIR ?? "dist/cache");
const CONCURRENCY = Number(process.env.BUILD_CONCURRENCY ?? 1);
const QUEUE = Number(process.env.BUILD_QUEUE ?? 8);
const TIMEOUT = Number(process.env.BUILD_TIMEOUT ?? 180) * 1000;
const CACHE_ENTRIES = Number(process.env.CACHE_ENTRIES ?? 300);
const PER_IP = Number(process.env.BUILD_PER_IP ?? 2);
const RATE_LIMIT = Number(process.env.BUILD_RATE_LIMIT ?? 10);
const RATE_WINDOW = Number(process.env.BUILD_RATE_WINDOW ?? 600) * 1000;
const IP_HEADER = process.env.CLIENT_IP_HEADER?.toLowerCase();

const SLUGS = loadChapters().map((c) => c.slug);

/** A digest of everything a build reads, so cached builds are dropped when the text or code changes. */
function sourceVersion() {
  const h = new Bun.CryptoHasher("sha256");
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else h.update(p.slice(ROOT.length)).update(readFileSync(p));
    }
  };
  for (const d of ["content", "src", "assets", "data"]) walk(join(ROOT, d));
  return h.digest("hex").slice(0, 16);
}
const VERSION = sourceVersion();

// ---- Requests from the form.

interface BuildRequest {
  ceremony: Ceremony;
  occasion: Occasion;
  lang: Lang;
  target: "pdf" | "epub" | "html" | "md";
  paper: "a4" | "a5" | "booklet";
  size: number;
  columns: boolean;
  signature?: number;
  chapters: string[];
  notes: boolean;
  instructions: boolean;
}

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], name: string, errors: string[]): T | undefined => {
  if (v === undefined) return undefined;
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
  errors.push(`${name} must be one of ${allowed.join(", ")}`);
};
const int = (v: unknown, lo: number, hi: number, name: string, errors: string[]) => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi) return v;
  errors.push(`${name} must be a whole number from ${lo} to ${hi}`);
};

/** Check a form selection and turn it into build.ts arguments. Nothing from the request reaches a shell. */
function parse(body: any): { req?: BuildRequest; args: string[]; errors: string[] } {
  const errors: string[] = [];
  if (!body || typeof body !== "object") return { args: [], errors: ["the request must be a JSON object"] };
  const o = body.occasion ?? {};
  const occasion: Occasion = {
    time: oneOf(o.time, OCCASION_CHOICES.time, "time", errors),
    helpers: oneOf(o.helpers, OCCASION_CHOICES.helpers, "helpers", errors),
    season: oneOf(o.season, OCCASION_CHOICES.season, "season", errors),
    adhika: o.adhika === true ? true : undefined,
    fortnight: int(o.fortnight, 1, 10, "fortnight", errors),
    bhikkhus: int(o.bhikkhus, 1, 500, "bhikkhus", errors),
    form: int(o.form, 1, 9, "form", errors),
    day: oneOf(o.day, OCCASION_CHOICES.day, "day", errors),
    address: oneOf(o.address, OCCASION_CHOICES.address, "address", errors),
    statements: oneOf(o.statements, OCCASION_CHOICES.statements, "statements", errors),
  };
  for (const k of Object.keys(occasion) as (keyof Occasion)[]) if (occasion[k] === undefined) delete occasion[k];
  errors.push(...occasionErrors(occasion));

  const chapters: string[] = Array.isArray(body.chapters) ? body.chapters.filter((c: unknown) => typeof c === "string") : [];
  const unknown = chapters.filter((c) => !SLUGS.includes(c));
  if (unknown.length) errors.push(`unknown chapters: ${unknown.join(", ")}`);

  const req: BuildRequest = {
    ceremony: oneOf(body.ceremony, Object.keys(CEREMONIES) as Ceremony[], "ceremony", errors) ?? "uposatha",
    occasion,
    lang: oneOf(body.lang, ["both", "pali", "english"] as const, "lang", errors) ?? "both",
    target: oneOf(body.target, ["pdf", "epub", "html", "md"] as const, "target", errors) ?? "pdf",
    paper: oneOf(body.paper, ["a4", "a5", "booklet"] as const, "paper", errors) ?? "a5",
    size: int(body.size, 8, 28, "size", errors) ?? 13,
    columns: body.columns === true,
    signature: int(body.signature, 4, 64, "signature", errors),
    chapters: SLUGS.filter((s) => chapters.includes(s)),
    notes: body.notes === true,
    instructions: body.instructions === true,
  };
  if (req.signature && req.signature % 4) errors.push("signature must be a multiple of 4");
  if (!req.chapters.length) errors.push("choose at least one chapter");

  const args = [req.target, "--lang", req.lang];
  if (req.target === "pdf") {
    args.push("--paper", req.paper, "--size", String(req.size));
    if (req.columns && req.lang === "both" && req.paper !== "booklet") args.push("--columns");
    if (req.signature && req.paper === "booklet") args.push("--signature", String(req.signature));
  }
  if (req.chapters.length !== SLUGS.length) args.push("--chapters", req.chapters.join(","));
  args.push(req.notes ? "--notes" : "--no-notes");
  args.push(req.instructions ? "--instructions" : "--no-instructions");
  // Corrections are on by default; the site always builds with them (--no-corrections isn't offered).
  const oc = occasion;
  if (oc.time) args.push("--time", oc.time);
  if (oc.helpers) args.push("--helpers", oc.helpers);
  if (oc.season) args.push("--season", oc.season);
  if (oc.adhika) args.push("--adhika");
  if (oc.fortnight) args.push("--fortnight", String(oc.fortnight));
  if (oc.bhikkhus) args.push("--bhikkhus", oc.form && oc.form > 1 ? `${oc.bhikkhus}:${oc.form}` : String(oc.bhikkhus));
  if (oc.day) args.push("--day", oc.day);
  if (oc.address) args.push("--address", oc.address);
  if (oc.statements) args.push("--statements", oc.statements);
  return { req, args, errors };
}

const command = (args: string[]) => ["bun run build --", ...args.map((a) => (/^[\w.,:=\/-]+$/.test(a) ? a : `'${a}'`))].join(" ");

// ---- Builds: queued, time-limited, cached.

let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= CONCURRENCY) {
    if (waiting.length >= QUEUE) throw new HttpError(503, "The server is busy with other builds. Try again in a minute.");
    await new Promise<void>((r) => waiting.push(r));
  }
  running++;
  try { return await fn(); } finally { running--; waiting.shift()?.(); }
}

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

// ---- Per-address limits on builds that have to run (not cached, not already in progress).

const active = new Map<string, number>();
const started = new Map<string, number[]>();

function admit(ip: string) {
  if ((active.get(ip) ?? 0) >= PER_IP) throw new HttpError(429, "You already have builds in progress. Wait for them to finish.");
  const now = Date.now();
  const recent = (started.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW);
  if (RATE_LIMIT > 0 && recent.length >= RATE_LIMIT) {
    const minutes = Math.ceil((recent[0]! + RATE_WINDOW - now) / 60_000);
    throw new HttpError(429, `Too many custom builds from your address. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }
  recent.push(now);
  started.set(ip, recent);
  active.set(ip, (active.get(ip) ?? 0) + 1);
}

function release(ip: string) {
  const n = (active.get(ip) ?? 1) - 1;
  if (n > 0) active.set(ip, n); else active.delete(ip);
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of started) if (ts.every((t) => now - t >= RATE_WINDOW)) started.delete(ip);
}, 60_000).unref();

const inflight = new Map<string, Promise<string>>();

async function build(req: BuildRequest, args: string[], ip: string): Promise<string> {
  const key = new Bun.CryptoHasher("sha256").update(VERSION).update(JSON.stringify(args)).digest("hex").slice(0, 24);
  const dir = join(CACHE, key);
  try {
    const [file] = readdirSync(dir);
    if (file) return join(dir, file);
  } catch {}
  if (!inflight.has(key)) {
    admit(ip);
    inflight.set(key, slot(() => run(req, args, dir)).finally(() => { inflight.delete(key); release(ip); }));
  }
  return inflight.get(key)!;
}

async function run(req: BuildRequest, args: string[], dir: string) {
  // Built inside the cache directory so the finished file can be renamed into place.
  const tmp = mkdtempSync(join(CACHE, ".build-"));
  try {
    const p = Bun.spawn(["bun", "src/build.ts", ...args, "--out", tmp], {
      cwd: ROOT, stdout: "pipe", stderr: "pipe",
      env: { ...process.env, FORCE_SOURCE_DATE: "1", SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH ?? String(Math.floor(Date.now() / 1000)) },
    });
    const timer = setTimeout(() => p.kill(), TIMEOUT);
    const code = await p.exited;
    clearTimeout(timer);
    if (code !== 0) {
      const err = (await new Response(p.stderr).text()).trim().split("\n").filter(Boolean).slice(-6).join("\n");
      console.error(`build failed (${code}): ${command(args)}\n${err}`);
      throw new HttpError(500, p.signalCode ? "The build took too long and was stopped." : `The build failed: ${err.split("\n").pop()}`);
    }
    const out = join(tmp, req.lang);
    const base = baseName(req.lang);
    const kind = req.target === "pdf" ? req.paper : req.target;
    const built = req.target === "md" ? await zipMarkdown(out, base) : join(out, FORMATS.find((f) => f.kind === kind)!.built(base));
    const name = releaseName(req.lang, kind, (await hashFile(built)).short, { custom: true });
    const staged = join(tmp, "entry");
    mkdirSync(staged);
    renameSync(built, join(staged, name));
    rmSync(dir, { recursive: true, force: true });
    renameSync(staged, dir);
    prune();
    return join(dir, name);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function prune() {
  const entries = readdirSync(CACHE).filter((d) => !d.startsWith(".")).map((d) => ({ d, t: statSync(join(CACHE, d)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const { d } of entries.slice(CACHE_ENTRIES)) rmSync(join(CACHE, d), { recursive: true, force: true });
}

// ---- HTTP.

const TYPES: Record<string, string> = {
  pdf: "application/pdf", epub: "application/epub+zip", html: "text/html; charset=utf-8", zip: "application/zip",
  json: "application/json", woff2: "font/woff2", ttf: "font/ttf", md: "text/markdown; charset=utf-8",
};
const type = (path: string) => TYPES[path.split(".").pop()!] ?? "application/octet-stream";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

async function readBody(r: Request) {
  const text = await r.text();
  if (text.length > 16_000) throw new HttpError(413, "The request is too large.");
  try { return JSON.parse(text); } catch { throw new HttpError(400, "The request is not JSON."); }
}

async function staticFile(pathname: string) {
  const path = resolve(SITE, "." + decodeURIComponent(pathname === "/" ? "/index.html" : pathname));
  if (path !== SITE && !path.startsWith(SITE + sep)) return new Response("Not found", { status: 404 });
  const file = Bun.file(path);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  const hashed = /\/(files|fonts)\//.test(pathname);
  return new Response(file, {
    headers: {
      "content-type": type(path),
      "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
      ...(pathname.startsWith("/files/") && { "content-disposition": "attachment" }),
    },
  });
}

mkdirSync(CACHE, { recursive: true });
// Builds interrupted by a restart leave their working directories behind.
for (const d of readdirSync(CACHE)) if (d.startsWith(".build-")) rmSync(join(CACHE, d), { recursive: true, force: true });

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  hostname: process.env.HOST ?? "0.0.0.0",
  async fetch(r, server) {
    const { pathname } = new URL(r.url);
    try {
      if (pathname === "/api/health") return json({ ok: true, version: VERSION, running, waiting: waiting.length });

      if (pathname === "/api/preview" && r.method === "POST") {
        const { req, args, errors } = parse(await readBody(r));
        const occasionOk = !errors.some((e) => !/chapter/.test(e));
        const html = req && occasionOk ? previewHtml(req.ceremony, req.occasion, req.lang, req.chapters) : undefined;
        return json({ html, command: errors.length ? undefined : command(args), errors });
      }

      if (pathname === "/api/build" && r.method === "POST") {
        const { req, args, errors } = parse(await readBody(r));
        if (errors.length || !req) return json({ error: errors.join("; ") }, 400);
        const ip = (IP_HEADER && r.headers.get(IP_HEADER)?.split(",")[0]?.trim()) || server.requestIP(r)?.address || "unknown";
        const path = await build(req, args, ip);
        const name = path.split(sep).pop()!;
        return new Response(Bun.file(path), {
          headers: { "content-type": type(name), "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
        });
      }

      if (pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
      if (r.method !== "GET" && r.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      return await staticFile(pathname);
    } catch (e) {
      if (e instanceof HttpError) {
        const res = json({ error: e.message }, e.status);
        if (e.status === 429 || e.status === 503) res.headers.set("retry-after", "60");
        return res;
      }
      console.error(e);
      return json({ error: "Something went wrong on the server." }, 500);
    }
  },
});

console.log(`serving ${SITE} on http://${server.hostname}:${server.port}`);
