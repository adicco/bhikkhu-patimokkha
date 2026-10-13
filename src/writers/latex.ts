import { Tag, type RenderableTreeNode } from "@markdoc/markdoc";
import type { Rendered } from "../load";
import type { Show } from "../options";
import { cls, isInline, languages, tags } from "./walk";

const RUN_ON = new Set(["parajika", "sanghadisesa", "aniyata", "nissaggiya", "pacittiya", "patidesaniya", "sekhiya", "adhikarana-samatha", "conclusion"]);

export function esc(s: string): string {
  return s.replace(/[\\{}$&#^_%~]/g, (c) => ({
    "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", $: "\\$", "&": "\\&", "#": "\\#",
    "^": "\\textasciicircum{}", _: "\\_", "%": "\\%", "~": "\\textasciitilde{}",
  })[c]!);
}

export interface LatexOptions {
  title: string;
  paper: "a4" | "a5";
  fontSize: number;
  /**
   * How bilingual passages are set:
   * - stacked: the English under the Pāli, smaller and grey (default)
   * - columns: Pāli and English side by side
   * - facing:  Pāli on the left page, English on the facing right page, as in the printed book
   */
  layout?: "stacked" | "columns" | "facing";
  /** Pāli words (lowercase) never to be broken by the English patterns when quoted in English. */
  paliWords?: Iterable<string>;
}

export function toLatex(chapters: Rendered[], show: Show, opts: LatexOptions): string {
  const both = show.pali && show.english;
  const layout = both ? opts.layout ?? "stacked" : "stacked";
  /** True while typesetting the facing-pages (paracol) part of the book. */
  let open = false;
  const english = (s: string) => `{\\englishcolor ${s}}`;
  /** True while typesetting a centred passage, whose Pāli must not be set ragged-right. */
  let centering = false;
  /** Pāli breaks only at the hyphens the book prints (compounds), never by the English patterns;
   *  without hyphenation, justified lines open wide gaps, so it is set ragged-right. */
  const paliBlock = (s: string) => `{\\pali${centering ? "" : "\\paliragged"}\n${s}\\par}`;

  function inline(n: RenderableTreeNode): string {
    if (typeof n === "string") return esc(n);
    if (!Tag.isTag(n)) return Array.isArray(n) ? n.map(inline).join("") : "";
    const inner = () => n.children.map(inline).join("");
    switch (n.name) {
      case "em": return `\\textit{${inner()}}`;
      case "strong": return `\\textbf{${inner()}}`;
      case "br": return "\\\\\n";
      case "sup": return `\\textsuperscript{${inner()}}`;
    }
    if (n.attributes.lang === "pi") return `{\\pali ${inner()}}`;
    if (cls(n, "num")) return `\\textbf{${inner()}}`;
    if (cls(n, "call")) return `\\textit{${inner()}}`;
    if (cls(n, "lead")) return `[${inner()}]`;
    if (cls(n, "indent")) return "\\hspace*{2em}";
    if (cls(n, "changed")) return `\\textsc{${inner()}}`;
    if (cls(n, "var")) return `\\textit{${inner()}}`;
    if (cls(n, "rubric")) return `\\textit{(\\,${pair(n, ")\\quad(")}\\,)}`;
    return inner();
  }

  const pair = (n: Tag, sep: string) => {
    const { pali, english: en } = languages(n);
    return [pali && inline(pali), en && english(inline(en))].filter(Boolean).join(sep);
  };

  function blocks(nodes: RenderableTreeNode[]): string {
    return nodes.map(block).filter((s) => s.trim()).join("\n\n");
  }

  const item = (li: Tag) => (isInline(li.children) ? li.children.map(inline).join("") : blocks(li.children));

  const centered = (s: string) => `\\begin{center}${s}\\end{center}`;

  function block(n: RenderableTreeNode): string {
    if (typeof n === "string") return esc(n);
    if (!Tag.isTag(n)) return "";
    const kids = n.children;
    if (/^h[1-6]$/.test(n.name)) {
      const parts = tags(kids).map((k) => (cls(k, "english") ? english(inline(k)) : inline(k)));
      const level = Number(n.name[1]);
      if (open) {
        // Each page gets its own language; a heading given once goes on both pages.
        const h = (t: string) => (level <= 2 ? `\\heading{${t}}` : `\\subheading{${t}}`);
        return `\\switchcolumn[0]*\n${h(parts[0]!)}\n\\switchcolumn[1]\n${h(parts[1] ?? parts[0]!)}`;
      }
      if (level <= 2) return `\\heading{${parts.join("\\\\[2pt]\\normalsize ")}}`;
      return `\\subheading{${parts.join(" \\textperiodcentered{} ")}}`;
    }
    if (open && (cls(n, "response") || cls(n, "rubric") || cls(n, "vagga"))) {
      const { pali, english: en } = languages(n);
      const fmt = (t: Tag) => (cls(n, "vagga") ? inline(t) : `\\textit{(\\,${inline(t)}\\,)}`);
      return `\\switchcolumn[0]*\n${pali ? centered(fmt(pali)) : ""}\n\\switchcolumn[1]\n${en ? centered(fmt(en)) : ""}`;
    }
    if (cls(n, "response") || cls(n, "rubric")) return centered(`\\textit{(\\,${pair(n, "\\,)}\\\\\\textit{(\\,")}\\,)}`);
    if (cls(n, "vagga")) return centered(pair(n, "\\\\"));
    switch (n.name) {
      case "p": return kids.map(inline).join("");
      case "ol": return `\\begin{enumerate}\n${tags(kids).map((li) => `\\item ${item(li)}`).join("\n")}\n\\end{enumerate}`;
      case "ul": return `\\begin{itemize}[label={},leftmargin=1.5em]\n${tags(kids).map((li) => `\\item ${item(li)}`).join("\n")}\n\\end{itemize}`;
      case "header": return `\\begin{titlepage}\\centering\\vspace*{0.25\\textheight}{\\Huge ${inline(kids[0]!)}\\par}\\vspace{1em}{\\large\\scshape ${inline(kids[1]!)}\\par}\\end{titlepage}`;
    }
    if (cls(n, "lines")) return `\\begin{lines}${n.attributes.class.includes("indented") ? "[3em]" : ""}\n${blocks(kids)}\n\\end{lines}`;
    if (cls(n, "stanza")) return `\\begin{stanza}\n${blocks(kids)}\n\\end{stanza}`;
    if (cls(n, "colophon")) return `{\\small\\setlength{\\parindent}{0pt}\n${blocks(kids)}\\par}`;
    if (cls(n, "instruction")) return `{\\itshape\n${blocks(kids)}\\par}`;
    if (cls(n, "note")) {
      return `\\begin{notepara}{${n.attributes["data-label"]}}\n${blocks(kids)}\n\\end{notepara}`;
    }
    if (cls(n, "numbers")) return `\\begin{multicols}{2}\\small\\pali\n${blocks(kids)}\n\\end{multicols}`;
    if (cls(n, "epigraph")) return `\\vfill\\begin{center}\\itshape\n${blocks(kids)}\n\\end{center}\\vfill\\clearpage`;
    if (cls(n, "source")) return `\\hfill\\upshape ${kids.map(inline).join("")}`;
    if (cls(n, "passage")) {
      const speaker = n.attributes["data-speaker"] ? `\\noindent\\textit{${esc(n.attributes["data-speaker"])}:}\\par\n` : "";
      const center = cls(n, "align-center");
      const { pali, english } = languages(n);
      const wrap = (s: string) => (center ? centered(s) : s);
      // Centred Pāli stays centred rather than ragged-right.
      centering = center;
      try {
        if (open && pali && english) {
          // Left and right pages stay in step at every passage (paracol's synchronised switch).
          return `\\switchcolumn[0]*\n${speaker}${wrap(paliBlock(blocks(pali.children)))}\n\\switchcolumn[1]\n${speaker}${wrap(blocks(english.children))}`;
        }
        if (layout === "columns" && pali && english) {
          // Columns stay in step at every passage (paracol's synchronised switch).
          return `\\begin{paracol}{2}\n\\RaggedRight\\setlength{\\parindent}{1.5em}\n${speaker}${wrap(paliBlock(blocks(pali.children)))}\n\\switchcolumn\n\\RaggedRight\\setlength{\\parindent}{1.5em}\n${speaker ? "\\mbox{}\\par\n" : ""}{\\englishfont\n${wrap(blocks(english.children))}\\par}\n\\end{paracol}`;
        }
        const body = speaker + blocks(kids);
        if (open) return `\\switchcolumn[${english ? 1 : 0}]*\n${wrap(body)}`;
        return wrap(body);
      } finally { centering = false; }
    }
    if (n.attributes.lang === "pi") return paliBlock(blocks(kids));
    if (cls(n, "english") && both) {
      // Stacked: the English follows its Pāli, set off by a little space.
      const gap = layout === "stacked" ? "\\par\\vspace{0.15em}" : "";
      return `${gap}{\\englishfont\n${blocks(kids)}\\par}`;
    }
    return blocks(kids);
  }

  /** Top level of a facing-pages chapter: pairs split themselves across the pages; English-only
   *  instructions go on the right page, anything else (e.g. a note with a Pāli variant) on the left. */
  function facingBlocks(nodes: RenderableTreeNode[]): string {
    const split = ["passage", "heading", "response", "rubric", "vagga"];
    return nodes.map((n) => {
      const out = block(n);
      if (!out.trim() || split.some((c) => cls(n, c))) return out;
      return `\\switchcolumn[${cls(n, "instruction") ? 1 : 0}]*\n${out}`;
    }).filter((s) => s.trim()).join("\n\n");
  }

  // Facing pages: the bilingual chapters go in a parallel-paging paracol (column 0 on the
  // left/even pages, column 1 on the right/odd pages). Front matter and notes stay single-page.
  const isFacing = (c: Rendered) => layout === "facing" && c.chapter.slug !== "front" && c.chapter.kind !== "notes";
  const body = chapters.map((c) => {
    const { chapter, tree } = c;
    let brk = RUN_ON.has(chapter.slug) ? "\\bigskip" : "\\clearpage";
    if (isFacing(c) && !open) { open = true; brk = "\\clearpage\\ifodd\\value{page}\\hbox{}\\newpage\\fi\n\\begin{paracol}[1]*{2}"; }
    else if (!isFacing(c) && open) { open = false; brk = `\\end{paracol}\n${brk}`; }
    else if (open) brk = `\\switchcolumn[0]*${brk}`;
    const content = open ? facingBlocks(tree.children) : blocks(tree.children);
    return `% ---- ${chapter.file}\n${brk}\n\\phantomsection\\addcontentsline{toc}{section}{${esc(chapter.title)}}\n${content}`;
  }).join("\n\n") + (open ? "\n\\end{paracol}" : "");

  const geometry = opts.paper === "a5"
    ? "a5paper,inner=18mm,outer=14mm,top=16mm,bottom=18mm"
    : "a4paper,inner=25mm,outer=20mm,top=20mm,bottom=22mm";

  // article itself only knows 10, 11 and 12pt and silently falls back to 10pt for anything else;
  // other sizes go through the fontsize package, which scales \small, \large etc. to match.
  const classSize = [10, 11, 12].includes(opts.fontSize);
  // English beside or under the Pāli is set at 12/13 of the base (12pt at the default 13pt); on
  // the booklet's facing page it is the main text, at full size.
  const englishSize = +(opts.fontSize * 12 / 13).toFixed(2);
  // An exception with no break points: the English patterns leave the word whole (and its plural,
  // as in "Uposathas"). Breaks at printed hyphens are unaffected.
  const words = [...new Set([...opts.paliWords ?? []].flatMap((w) => [w, `${w}s`]))].sort();
  const hyphenation = words.length ? `\\hyphenation{${words.join(" ")}}\n` : "";
  return String.raw`\documentclass[${classSize ? `${opts.fontSize}pt,` : ""}twoside]{article}
${classSize ? "" : `\\usepackage[fontsize=${opts.fontSize}pt]{fontsize}\n`}\usepackage[${geometry}]{geometry}
\usepackage{fontspec}
\usepackage{xcolor}
\setmainfont{Gentium Plus}
% Pāli: a language with no hyphenation patterns, so lines break only at printed hyphens.
\newlanguage\palilanguage
\newcommand{\pali}{\language=\palilanguage\relax}
\newcommand{\paliragged}{\RaggedRight\setlength{\parindent}{1.5em}}
${hyphenation}\usepackage{microtype}
\usepackage{paracol}
\usepackage{ragged2e}
\usepackage{multicol}
\usepackage[shortlabels]{enumitem}
\usepackage{fancyhdr}
\usepackage[hidelinks]{hyperref}
\hypersetup{pdftitle={${esc(opts.title)}}}
\setlength{\parindent}{1.5em}
\setlength{\parskip}{0.35em}
\setlength{\columnsep}{1.6em}
\linespread{1.08}
\sloppy\emergencystretch=3em
\setlist{nosep,leftmargin=2.2em}
\newcommand{\englishcolor}{${layout === "stacked" ? "\\color{black!60}" : ""}}
\newcommand{\englishfont}{${layout === "facing" ? "" : `\\fontsize{${englishSize}pt}{${+(englishSize * 1.2).toFixed(2)}pt}\\selectfont`}\englishcolor}
\newcommand{\heading}[1]{\par\bigskip{\centering\large\scshape #1\par}\nopagebreak\medskip}
\newcommand{\subheading}[1]{\par\medskip{\centering\itshape #1\par}\nopagebreak\smallskip}
\newenvironment{lines}[1][1.5em]{\par\begingroup\setlength{\parindent}{0pt}\setlength{\leftskip}{#1}\raggedright}{\par\endgroup}
\newenvironment{stanza}{\par\begingroup\setlength{\parindent}{0pt}\setlength{\leftskip}{1.5em}\raggedright}{\par\endgroup\smallskip}
\newenvironment{notepara}[1]{\par\noindent\textbf{#1.}\ \itshape\ignorespaces}{\par}
\pagestyle{fancy}\fancyhf{}\fancyfoot[C]{\small\thepage}\renewcommand{\headrulewidth}{0pt}
\begin{document}
${body}
\end{document}
`;
}
