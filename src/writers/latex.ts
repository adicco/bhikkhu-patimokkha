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
}

export function toLatex(chapters: Rendered[], show: Show, opts: LatexOptions): string {
  const both = show.pali && show.english;

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
    const { pali, english } = languages(n);
    return [pali, english].filter(Boolean).map((t) => inline(t!)).join(sep);
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
      const parts = tags(kids).map((k) => inline(k));
      const level = Number(n.name[1]);
      if (level <= 2) return `\\heading{${parts.join("\\\\[2pt]\\normalsize ")}}`;
      return `\\subheading{${parts.join(" \\textperiodcentered{} ")}}`;
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
    if (cls(n, "instruction")) return `{\\itshape\n${blocks(kids)}\\par}`;
    if (cls(n, "note")) {
      return `\\begin{notepara}{${n.attributes["data-label"]}}\n${blocks(kids)}\n\\end{notepara}`;
    }
    if (cls(n, "numbers")) return `\\begin{multicols}{2}\\small\n${blocks(kids)}\n\\end{multicols}`;
    if (cls(n, "epigraph")) return `\\vfill\\begin{center}\\itshape\n${blocks(kids)}\n\\end{center}\\vfill\\clearpage`;
    if (cls(n, "source")) return `\\hfill\\upshape ${kids.map(inline).join("")}`;
    if (cls(n, "passage")) {
      const speaker = n.attributes["data-speaker"] ? `\\noindent\\textit{${esc(n.attributes["data-speaker"])}:}\\par\n` : "";
      const center = cls(n, "align-center");
      const { pali, english } = languages(n);
      if (both && pali && english) {
        // Columns stay in step at every passage (paracol's synchronised switch).
        const wrap = (s: string) => (center ? centered(s) : s);
        return `\\begin{paracol}{2}\n\\RaggedRight\\setlength{\\parindent}{1.5em}\n${speaker}${wrap(blocks(pali.children))}\n\\switchcolumn\n\\RaggedRight\\setlength{\\parindent}{1.5em}\n${speaker ? "\\mbox{}\\par\n" : ""}{\\englishfont\n${wrap(blocks(english.children))}\\par}\n\\end{paracol}`;
      }
      const body = speaker + blocks(kids);
      return center ? centered(body) : body;
    }
    if (cls(n, "english") && both) return `{\\englishfont\n${blocks(kids)}\\par}`;
    return blocks(kids);
  }

  const body = chapters.map(({ chapter, tree }) => {
    const brk = RUN_ON.has(chapter.slug) ? "\\bigskip" : "\\clearpage";
    return `% ---- ${chapter.file}\n${brk}\n\\phantomsection\\addcontentsline{toc}{section}{${esc(chapter.title)}}\n${blocks(tree.children)}`;
  }).join("\n\n");

  const geometry = opts.paper === "a5"
    ? "a5paper,inner=18mm,outer=14mm,top=16mm,bottom=18mm"
    : "a4paper,inner=25mm,outer=20mm,top=20mm,bottom=22mm";

  return String.raw`\documentclass[${opts.fontSize}pt,twoside]{article}
\usepackage[${geometry}]{geometry}
\usepackage{fontspec}
\setmainfont{Gentium Plus}
\usepackage{microtype}
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
\newcommand{\englishfont}{\small}
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
