/// <reference lib="dom" />  // for the code that page.evaluate runs in the browser
/**
 * Cloudflare Turnstile on custom builds: the server, given keys, refuses builds without a token
 * that siteverify accepts, and the page fetches one when the button is pressed. Cloudflare is
 * stood in for on both sides: a local siteverify, and a widget script served to the browser.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Browser, Page } from "playwright-core";
import { buildFromForm, change, launch, open, startSite, type Site } from "./harness";

const SITE_KEY = "test-site-key";
const SECRET = "test-secret";

/** Siteverify: "good-token" passes for the "build" action; "other-action" passes for another. */
const verified: URLSearchParams[] = [];
const verify = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(r) {
    const form = new URLSearchParams(await r.text());
    verified.push(form);
    const ok = form.get("secret") === SECRET && ["good-token", "other-action"].includes(form.get("response")!);
    return Response.json(ok
      ? { success: true, action: form.get("response") === "good-token" ? "build" : "other" }
      : { success: false, "error-codes": ["invalid-input-response"] });
  },
});

/** The widget: renders nothing and hands over `token` when executed; reset and execute are counted. */
const widgetScript = (token: string) => `
  window.turnstileCalls = [];
  window.turnstile = {
    render(el, o) { turnstileCalls.push(["render", o.sitekey, o.action, o.execution]); this.o = o; return "w1"; },
    reset(id) { turnstileCalls.push(["reset", id]); },
    execute(id) { turnstileCalls.push(["execute", id]); setTimeout(() => this.o.callback(${JSON.stringify(token)}), 10); },
  };
  window[new URL(document.currentScript.src).searchParams.get("onload")]();
`;
const stubWidget = (token: string) => (page: Page) =>
  page.route("https://challenges.cloudflare.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: widgetScript(token) }));

let site: Site;
let browser: Browser;
beforeAll(async () => {
  [site, browser] = await Promise.all([
    startSite({ TURNSTILE_SITE_KEY: SITE_KEY, TURNSTILE_SECRET_KEY: SECRET, TURNSTILE_VERIFY_URL: `http://127.0.0.1:${verify.port}/` }),
    launch(),
  ]);
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await site?.stop();
  verify.stop(true);
});

describe("the API", () => {
  const valid = { ceremony: "uposatha", lang: "both", target: "html", chapters: ["pubba-kicca"], occasion: {} };
  const build = (body: object) =>
    fetch(site.url + "api/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  test("health gives the page the site key, not the secret", async () => {
    const health = await (await fetch(site.url + "api/health")).json();
    expect(health.turnstile).toBe(SITE_KEY);
    expect(JSON.stringify(health)).not.toContain(SECRET);
  });

  test("builds without a token, or with one siteverify refuses, are refused", async () => {
    verified.length = 0;
    for (const turnstile of [undefined, "", 42, "x".repeat(3000)]) expect((await build({ ...valid, turnstile })).status).toBe(403);
    expect(verified).toHaveLength(0);   // refused without asking Cloudflare
    expect((await build({ ...valid, turnstile: "bad-token" })).status).toBe(403);
    expect((await build({ ...valid, turnstile: "other-action" })).status).toBe(403);
    expect(verified.map((f) => f.get("response"))).toEqual(["bad-token", "other-action"]);
  });

  test("invalid requests are refused before the token is checked", async () => {
    verified.length = 0;
    expect((await build({ ...valid, target: "docx", turnstile: "good-token" })).status).toBe(400);
    expect(verified).toHaveLength(0);
  });

  test("a good token builds, and siteverify hears the secret and the client's address", async () => {
    verified.length = 0;
    const res = await build({ ...valid, turnstile: "good-token" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/\.custom\.[0-9a-f]{10}\.html"$/);
    expect(verified).toHaveLength(1);
    expect(verified[0]!.get("secret")).toBe(SECRET);
    expect(verified[0]!.get("remoteip")).toBe("127.0.0.1");
  }, 120_000);
});

describe("the page", () => {
  test("pressing Build gets a fresh token and sends it with the build", async () => {
    const o = await open(browser, site, { setup: stubWidget("good-token") });
    try {
      const { page } = o;
      await page.waitForFunction(() => !(document.getElementById("build") as HTMLButtonElement).disabled);
      await change(page, () => page.check('input[name="target"][value="html"]'));
      const sent = page.waitForRequest((r) => r.url().endsWith("/api/build"));
      const built = await buildFromForm(page);
      expect((await sent).postDataJSON().turnstile).toBe("good-token");
      expect(built.status).toBe(`Built ${built.name}.`);
      expect(await page.evaluate(() => (window as any).turnstileCalls)).toEqual([
        ["render", SITE_KEY, "build", "execute"], ["reset", "w1"], ["execute", "w1"],
      ]);
      expect(await page.locator("#turnstile").isHidden()).toBe(true);
      expect(o.errors).toEqual([]);
    } finally {
      await o.close();
    }
  }, 120_000);

  test("a token the server refuses is reported", async () => {
    const o = await open(browser, site, { setup: stubWidget("bad-token") });
    try {
      const { page } = o;
      await page.waitForFunction(() => !(document.getElementById("build") as HTMLButtonElement).disabled);
      await page.click("#build");
      await page.waitForFunction(() => document.getElementById("status")!.className === "error");
      expect(await page.textContent("#status")).toBe("Not built: The check that you’re not a robot failed. Reload the page and try again.");
      expect(await page.isDisabled("#build")).toBe(false);
    } finally {
      await o.close();
    }
  });

  test("if the widget can't load, the form says so and won't build", async () => {
    const o = await open(browser, site, { setup: (page) => page.route("https://challenges.cloudflare.com/**", (r) => r.abort()) });
    try {
      const { page } = o;
      await page.waitForFunction(() => /robot check/.test(document.getElementById("status")!.textContent!));
      expect(await page.isDisabled("#build")).toBe(true);
    } finally {
      await o.close();
    }
  });
});
