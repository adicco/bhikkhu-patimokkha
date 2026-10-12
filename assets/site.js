// The custom-build form on the distribution page. DATA is embedded by src/site.ts.

// Light or dark: the system's choice until the switch is used, then the switch's, remembered.
(() => {
  const root = document.documentElement;
  const button = document.getElementById("theme");
  const system = matchMedia("(prefers-color-scheme: dark)");
  const current = () => root.dataset.theme ?? (system.matches ? "dark" : "light");
  // The icon follows the theme in CSS; only the words for screen readers and tooltips change here.
  const label = () => {
    const to = current() === "dark" ? "Switch to light" : "Switch to dark";
    button.setAttribute("aria-label", to);
    button.title = to;
  };
  button.addEventListener("click", () => {
    root.dataset.theme = current() === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch {}
    label();
  });
  system.addEventListener("change", label);
  label();
})();

(() => {
  const form = document.getElementById("custom");
  const $ = (sel) => form.querySelector(sel);
  const $$ = (sel) => [...form.querySelectorAll(sel)];
  const value = (name) => {
    const el = form.elements[name];
    if (!el) return undefined;
    if (el instanceof RadioNodeList) return el.value;
    return el.type === "checkbox" ? el.checked : el.value;
  };
  const set = (name, v) => {
    const el = form.elements[name];
    if (el instanceof RadioNodeList) for (const r of el) r.checked = r.value === String(v);
    else if (el.type === "checkbox") el.checked = !!v;
    else el.value = String(v);
  };

  const ORDINAL = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
  const FORMAT_LABEL = { pdf: "PDF", epub: "EPUB", html: "HTML", md: "Markdown" };
  const PAPER_LABEL = { a4: "A4 PDF", a5: "A5 PDF", booklet: "A5 booklet" };

  // ---- Dates: upcoming uposathas from the embedded calendar.
  const dateSelect = $("#date");
  const today = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const upcoming = DATA.days.filter((d) => d.date >= iso(today)).slice(0, 60);
  const fmt = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  for (const d of upcoming) {
    const o = document.createElement("option");
    o.value = d.date;
    o.textContent = `${fmt.format(new Date(d.date + "T00:00:00Z"))}, ${d.pavarana ? "Pavāraṇā" : `${d.moon} moon`}`;
    dateSelect.append(o);
  }
  const other = document.createElement("option");
  other.value = "";
  other.textContent = "Another day: set the details below";
  dateSelect.append(other);

  function applyDate() {
    const d = upcoming.find((x) => x.date === dateSelect.value);
    if (!d) return;
    set("ceremony", d.pavarana ? "pavarana" : value("ceremony") === "pavarana" ? "uposatha" : value("ceremony"));
    set("season", d.season);
    set("adhika", d.adhika);
    fillFortnights();
    if (!d.pavarana) set("fortnight", d.fortnight);
    set("day", d.day);
  }

  // ---- Fortnights: note 5's tables. The Pavāraṇā's place in a rainy season can't be chosen for an uposatha.
  function fillFortnights() {
    const sel = form.elements.fortnight;
    const keep = Number(sel.value) || 1;
    const t = DATA.seasons[(value("adhika") ? 2 : 0) + (value("season") === "vassana" ? 1 : 0)];
    sel.replaceChildren();
    for (let n = 1; n <= t.length; n++) {
      const o = document.createElement("option");
      o.value = n;
      o.textContent = n === t.pavarana ? `${ORDINAL[n - 1]}: the Pavāraṇā` : `${ORDINAL[n - 1]} of ${t.length}`;
      o.disabled = n === t.pavarana;
      sel.append(o);
    }
    sel.value = keep <= t.length && keep !== t.pavarana ? keep : 1;
  }

  // ---- Bhikkhus: note 6's numbers, each Pāli form its own choice.
  let bhikkhusChosen = false;
  let lastCeremony;
  function fillBhikkhus() {
    const sel = form.elements.bhikkhus;
    const keep = sel.value;
    const min = value("ceremony") === "pavarana" ? 5 : 4;
    sel.replaceChildren();
    for (const [n, forms] of DATA.numbers) {
      if (n < min) continue;
      forms.forEach((f, i) => {
        const o = document.createElement("option");
        o.value = `${n}:${i + 1}`;
        o.textContent = `${n}, ${f}`;
        o.lang = "pi";
        sel.append(o);
      });
    }
    // Keep a count someone chose; otherwise the lowest, which is the book's printed reading.
    sel.value = bhikkhusChosen && [...sel.options].some((o) => o.value === keep) ? keep : sel.options[0].value;
  }

  // ---- Chapters: each ceremony starts from its own selection.
  // The checkbox adds or removes a chapter; the name builds that chapter alone.
  const chapterBox = $("#chapters");
  for (const c of DATA.chapters) {
    const row = document.createElement("div");
    row.className = "choice";
    const box = Object.assign(document.createElement("input"), { type: "checkbox", name: "chapter", value: c.slug });
    box.setAttribute("aria-label", c.title);
    const solo = Object.assign(document.createElement("button"), { type: "button", className: "solo", textContent: c.title });
    solo.setAttribute("aria-describedby", "chapters-hint");
    solo.addEventListener("click", () => {
      for (const b of $$('input[name="chapter"]')) b.checked = b === box;
      form.dispatchEvent(new Event("change"));
    });
    row.append(box, solo);
    chapterBox.append(row);
  }
  const resetChapters = $("#reset-chapters");
  let preset = [];
  const chosen = () => $$('input[name="chapter"]:checked').map((b) => b.value);
  function syncReset() {
    resetChapters.hidden = chosen().join() === preset.join();
  }
  resetChapters.addEventListener("click", () => {
    presetChapters();
    form.dispatchEvent(new Event("change"));
    $('input[name="chapter"]').focus();
  });
  // An uposatha takes the whole Pāṭimokkha (notes too, unless Pāli only); the others their own chapter.
  function presetChapters() {
    const ceremony = value("ceremony");
    const others = [...DATA.ceremonies.pavarana, ...DATA.ceremonies.group];
    for (const box of $$('input[name="chapter"]')) {
      const c = DATA.chapters.find((x) => x.slug === box.value);
      box.checked = ceremony === "uposatha"
        ? !others.includes(c.slug) && !(c.notes && value("lang") === "pali")
        : c.slug === "front" || DATA.ceremonies[ceremony].includes(c.slug);
    }
    preset = chosen();
  }

  // ---- Visibility: only the questions that matter for this ceremony and format.
  function sync() {
    $("#upcoming").hidden = !upcoming[0] || dateSelect.value !== upcoming[0].date;
    const ceremony = value("ceremony");
    for (const el of $$("[data-for]")) el.hidden = !el.dataset.for.split(" ").includes(ceremony);
    const pdf = value("target") === "pdf";
    for (const el of $$("[data-pdf]")) el.hidden = !pdf;
    for (const el of $$("[data-booklet]")) el.hidden = value("paper") !== "booklet";
    for (const el of $$("[data-columns]")) el.hidden = !pdf || value("lang") !== "both" || value("paper") === "booklet";
    for (const el of $$("[data-english]")) el.hidden = value("lang") === "pali";
    if (value("day") === "harmony" && ceremony !== "pavarana") set("day", "fifteenth");
    const what = pdf ? PAPER_LABEL[value("paper")] : FORMAT_LABEL[value("target")];
    $("#build").textContent = `Build ${what}`;
    syncReset();

    // The preview follows the PDF's layout and type size: English under the Pāli (smaller, grey),
    // beside it (smaller), on the facing page of the booklet, or alone at full size.
    const lang = value("lang");
    const layout = lang !== "both" ? "single" : !pdf ? "stacked"
      : value("paper") === "booklet" ? "facing" : value("columns") ? "columns" : "stacked";
    const p = $("#preview");
    p.dataset.layout = layout;
    p.style.setProperty("--scale", pdf ? String(Number(value("size")) / 11) : "1");
  }

  // ---- The request: the same shape for the preview and the build.
  function request() {
    const ceremony = value("ceremony");
    const shown = (name) => {
      const el = form.elements[name];
      const node = el instanceof RadioNodeList ? el[0] : el;
      return node && !node.closest("[hidden]");
    };
    const occasion = {};
    for (const k of ["time", "helpers", "season", "day", "address", "statements"]) if (shown(k)) occasion[k] = value(k);
    if (shown("adhika") && value("adhika")) occasion.adhika = true;
    if (shown("fortnight")) occasion.fortnight = Number(value("fortnight"));
    if (shown("bhikkhus")) {
      const [n, f] = value("bhikkhus").split(":").map(Number);
      occasion.bhikkhus = n;
      occasion.form = f;
    }
    const chapters = $$('input[name="chapter"]:checked').map((b) => b.value);
    const notesChapter = DATA.chapters.find((c) => c.notes)?.slug;
    return {
      ceremony,
      occasion,
      lang: value("lang"),
      target: value("target"),
      paper: value("paper"),
      size: Number(value("size")),
      columns: !!value("columns"),
      signature: value("signature") ? Number(value("signature")) : undefined,
      chapters,
      notes: chapters.includes(notesChapter),
      instructions: value("lang") !== "pali" && value("instructions"),
    };
  }

  // ---- Preview: rendered by the server from the same text the build uses.
  const preview = $("#preview");
  const status = $("#status");
  const button = $("#build");
  let online = false;
  let timer;
  let seq = 0;
  let first = true;

  async function refresh() {
    const mine = ++seq;
    const body = request();
    preview.setAttribute("aria-busy", "true");
    try {
      const res = await fetch("api/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (mine !== seq) return;
      // The first answer replaces the printed text embedded in the page; only later changes are lit.
      const before = first ? new Map() : slotTexts();
      first = false;
      if (json.html !== undefined) preview.innerHTML = json.html;
      slotTexts().forEach((text, key) => {
        if (before.has(key) && before.get(key) !== text) {
          const s = preview.querySelector(`[data-key="${key}"]`);
          s.classList.add("lit");
          requestAnimationFrame(() => requestAnimationFrame(() => s.classList.remove("lit")));
        }
      });
      $("#unglossed-key").hidden = !preview.querySelector(".unglossed");
      const cli = form.querySelector(".cli");
      cli.hidden = !json.command;
      $("#cli").textContent = json.command ?? "";
      showErrors(json.errors);
    } catch {
      // The preview keeps the printed text; the build button says what's wrong.
    } finally {
      if (mine === seq) preview.removeAttribute("aria-busy");
    }
  }
  function showErrors(errors) {
    if (errors?.length) {
      const text = errors.join(". ") + ".";
      status.textContent = text[0].toUpperCase() + text.slice(1);
      status.className = "error";
      button.disabled = true;
    } else if (status.className === "error") {
      status.textContent = "";
      status.className = "";
      button.disabled = !online;
    }
  }
  // Slots keyed by language, name and occurrence, so that showing or hiding a language
  // doesn't make every reading look changed.
  function slotTexts() {
    const texts = new Map();
    const seen = {};
    for (const s of preview.querySelectorAll(".slot")) {
      const base = `${s.closest("[lang]")?.lang ?? ""}-${s.dataset.slot}`;
      const key = `${base}-${(seen[base] = (seen[base] ?? 0) + 1)}`;
      s.dataset.key = key;
      texts.set(key, s.textContent);
    }
    return texts;
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(refresh, 120); };

  form.addEventListener("change", (e) => {
    const name = e.target.name;
    const customised = chosen().join() !== preset.join();
    if (name === "bhikkhus") bhikkhusChosen = true;
    if (name === "date") applyDate();
    else if (["season", "adhika", "fortnight", "day", "ceremony"].includes(name) && dateSelect.value) {
      // A hand-made change no longer matches the calendar's date.
      const d = upcoming.find((x) => x.date === dateSelect.value);
      const matches = d && value("season") === d.season && value("adhika") === d.adhika && value("day") === d.day &&
        (d.pavarana ? value("ceremony") === "pavarana" : Number(value("fortnight")) === d.fortnight);
      if (!matches) dateSelect.value = "";
    }
    if (["season", "adhika"].includes(name)) fillFortnights();
    if (["ceremony", "date"].includes(name)) fillBhikkhus();
    // A new ceremony brings its own chapters; a new language only adjusts a selection nobody has
    // customised (Pāli only drops the notes). A chapter chosen by hand is kept otherwise.
    if (value("ceremony") !== lastCeremony || (name === "lang" && !customised)) presetChapters();
    lastCeremony = value("ceremony");
    if (name === "lang") set("size", value("lang") === "pali" ? 12 : 11);
    sync();
    later();
  });

  // ---- Build.
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!online) return;
    const body = request();
    if (!body.chapters.length) {
      status.textContent = "Choose at least one chapter.";
      status.className = "error";
      return;
    }
    button.disabled = true;
    status.className = "";
    status.textContent = body.target === "pdf" ? "Building… typesetting takes about ten seconds." : "Building…";
    try {
      const res = await fetch("api/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `The server answered ${res.status}.`);
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "bhikkhu-patimokkha";
      const blob = await res.blob();
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      status.textContent = `Built ${name}.`;
    } catch (err) {
      status.textContent = `Not built: ${err.message}`;
      status.className = "error";
    } finally {
      button.disabled = false;
    }
  });

  // ---- Start.
  dateSelect.value = upcoming[0]?.date ?? "";
  set("size", 11);
  applyDate();
  fillFortnights();
  if (upcoming[0] && !upcoming[0].pavarana) set("fortnight", upcoming[0].fortnight);
  fillBhikkhus();
  presetChapters();
  lastCeremony = value("ceremony");
  sync();

  fetch("api/health").then((r) => {
    if (!r.ok) throw new Error();
    online = true;
    button.disabled = false;
    refresh();
  }).catch(() => {
    button.disabled = true;
    status.textContent = "Custom builds need the site’s server, which isn’t answering. The downloads above still work.";
  });
})();
