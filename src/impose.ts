/**
 * The A6 booklet: A6 pages imposed four to a side of A4 (landscape), with a first sheet that
 * tells the reader how to make it up.
 *
 * Print double-sided (flip on the long edge), cut the stack of sheets down the middle, put the
 * right-hand pile under the left-hand one, fold the lot in half and staple at the fold. Each half
 * sheet is one folded A5 leaf of a single saddle-stitched gathering: with S sheets of A4, the
 * left halves are leaves 1…S (outermost first) and the right halves leaves S+1…2S.
 *
 * On the A4 sheet each half holds two A6 pages turned a quarter-turn anticlockwise (their tops
 * towards the sheet's left edge), the fold running across the middle; picked up and turned a
 * quarter-turn clockwise, a half reads as an ordinary A5 spread.
 */
import { esc } from "./writers/latex";

/** Millimetres. A6 is 105 × 148; half an A4 landscape sheet is 148.5 × 105. */
const W = 297, H = 210, HALF = W / 2;

/** Sheets of A4 (not counting the guide) for `pages` A6 pages. */
export const a6Sheets = (pages: number) => Math.max(1, Math.ceil(pages / 8));

/**
 * The pages on one side of one A4 sheet, as [left half, right half], each [lower, upper] slot:
 * the lower slot is the left-hand page of the half's spread, the upper slot the right-hand page.
 * Page numbers are 1-based; numbers past the last page are blanks.
 */
export function a6Side(sheet: number, sheets: number, back: boolean): [[number, number], [number, number]] {
  const n = 8 * sheets;
  const leaf = (half: number): [number, number] => {
    const j = half * sheets + sheet;
    return back ? [2 * j + 2, n - 2 * j - 1] : [n - 2 * j, 2 * j + 1];
  };
  return [leaf(0), leaf(1)];
}

export interface A6Options {
  /** The A6 PDF to impose (a file name LaTeX can find). */
  file: string;
  /** Its page count. */
  pages: number;
  title: string;
}

/** LuaLaTeX source for the imposed booklet, guide sheet first. */
export function a6Booklet({ file, pages, title }: A6Options): string {
  const sheets = a6Sheets(pages);
  const slots = (side: [[number, number], [number, number]]) => side.flatMap(([lower, upper], h) =>
    ([[lower, H / 4], [upper, (3 * H) / 4]] as const).filter(([p]) => p <= pages).map(([p, y]) =>
      `\\node[inner sep=0,rotate=90] at (${h * HALF + HALF / 2},${y}) {\\includegraphics[page=${p}]{${file}}};`));
  // Cut marks at the top and bottom edges, fold marks at the left and right edges and either
  // side of the cut, all within the margins and clear of the edge a printer can't reach.
  const marks = String.raw`\draw[line width=0.3pt] (${HALF},4) -- (${HALF},9) (${HALF},${H - 4}) -- (${HALF},${H - 9});
\draw[line width=0.3pt,dash pattern=on 1pt off 1pt] (4,${H / 2}) -- (9,${H / 2}) (${W - 4},${H / 2}) -- (${W - 9},${H / 2});`;
  const sheetNo = (s: number) =>
    `\\node[anchor=west,font=\\fontsize{5}{6}\\selectfont,text=black!50] at (${HALF + 1.5},${H - 6.5}) {${s + 1}/${sheets}};`;
  const page = (body: string) => String.raw`\AddToShipoutPictureFG*{\put(0,0){\begin{tikzpicture}[x=1mm,y=1mm]
\useasboundingbox (0,0) rectangle (${W},${H});
${body}
\end{tikzpicture}}}\null\newpage`;

  const imposed = Array.from({ length: sheets }, (_, s) => [
    page([...slots(a6Side(s, sheets, false)), marks, sheetNo(s)].join("\n")),
    page(slots(a6Side(s, sheets, true)).join("\n")),
  ].join("\n")).join("\n");

  return String.raw`\documentclass[11pt]{article}
\usepackage[a4paper,landscape,margin=14mm]{geometry}
\usepackage{fontspec}
\setmainfont{Gentium Plus}
\usepackage{graphicx}
\usepackage{eso-pic}
\usepackage{tikz}
\usepackage{enumitem}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\begin{document}
% The guide must fill exactly one side, or every sheet after it is out of step when duplexed.
\setbox0=\vbox{${guide(title, pages, sheets)}}
\ifdim\dimexpr\ht0+\dp0\relax>\textheight \errmessage{The A6 guide is taller than its page}\fi
\box0
\newpage\null\newpage
${imposed}
\end{document}
`;
}

/** The first sheet: how to print, cut, stack, fold and staple, with a picture of the sheet. */
function guide(title: string, pages: number, sheets: number): string {
  const [[l0, l1], [r0, r1]] = a6Side(0, sheets, false);
  // The first sheet in miniature, with its page numbers turned as they print.
  const k = 0.36, w = W * k, h = H * k, half = w / 2;
  const num = (p: number, x: number, y: number) =>
    `\\node[rotate=90,font=\\Large,text=black!${p <= pages ? 70 : 25}] at (${x},${y}) {${p}};`;
  const sheet = String.raw`\begin{tikzpicture}[x=1mm,y=1mm]
\draw[line width=0.6pt] (0,0) rectangle (${w},${h});
\draw[black!40,dash pattern=on 2pt off 1.5pt] (0,${h / 2}) -- (${w},${h / 2});
\draw[line width=0.8pt,dash pattern=on 4pt off 2pt] (${half},-5) -- (${half},${h + 5});
\node[above] at (${half},${h + 5}) {\small cut};
\node[left,black!60] at (0,${h / 2}) {\small fold};
\node[right,black!60] at (${w},${h / 2}) {\small fold};
${num(l0, half / 2, h / 4)}${num(l1, half / 2, (3 * h) / 4)}${num(r0, (3 * half) / 2, h / 4)}${num(r1, (3 * half) / 2, (3 * h) / 4)}
\node[below,font=\small] at (${half / 2},-1) {left half};
\node[below,font=\small] at (${(3 * half) / 2},-1) {right half};
\end{tikzpicture}`;
  // The two piles after cutting, smaller: the right-hand one goes under the left-hand one.
  const pw = half * 0.42, ph = h * 0.42;
  const pile = (x: number, label: string, fill: string) =>
    `\\foreach \\i in {3,2,1,0} {\\draw[fill=${fill}] (${x}+\\i*0.8,-\\i*0.8) rectangle +(${pw},${ph});}\n\\node[font=\\small] at (${x + pw / 2},${ph / 2}) {${label}};`;
  const stack = String.raw`\begin{tikzpicture}[x=1mm,y=1mm]
${pile(0, "left", "white")}
${pile(pw + 24, "right", "black!8")}
\draw[->,line width=0.8pt] (${pw * 1.5 + 24},${ph + 3}) to[out=150,in=30] node[above,font=\small] {goes under the left pile} (${pw / 2 + 4},${ph + 3});
\end{tikzpicture}`;

  const sheetWord = sheets === 1 ? "sheet" : "sheets";
  return String.raw`\begin{center}
{\LARGE\scshape ${esc(title)}}\\[3pt]
{\large A6 booklet: how to make it up}
\end{center}
\vspace{4mm}
\begin{minipage}[t]{0.47\linewidth}
\begin{enumerate}[leftmargin=1.6em,itemsep=0.5em,label=\textbf{\arabic*.}]
\item \textbf{Print} the whole file on A4, \textbf{double-sided, flipping on the long edge}
  (often called \emph{long-edge binding}), at \textbf{actual size} (100\%, not \emph{fit to page}).
  That is ${sheets + 1} sheets: this guide, whose back is blank, and ${sheets} ${sheetWord} of pages.
\item \textbf{Set this guide aside.} ${sheets === 1 ? "Lay the other sheet down," : "Put the other sheets in order, the first on top,"} the side
  with the small sheet number (\emph{1/${sheets}}) facing up.
\item \textbf{Cut} the whole stack in half down the middle, between the two short cut marks at
  the top and bottom edges. A guillotine, or a craft knife and a steel rule, does it in one go.
\item \textbf{Stack:} put the right-hand pile \textbf{under} the left-hand pile, without turning
  or rotating either.
\item \textbf{Fold} the stack in half across the middle, at the dotted fold marks, with the top
  sheet on the outside. Page 1 is then on the front; turn the booklet a quarter-turn to read it.
\item \textbf{Staple} twice through the fold from the outside (a long-reach stapler helps), then
  press the fold flat.
\end{enumerate}
\vspace{4mm}
\centering
${stack}\\[2mm]
{\small After cutting.}
\end{minipage}\hfill
\begin{minipage}[t]{0.47\linewidth}\centering
\vspace{4mm}
${sheet}\\[3mm]
{\small The first sheet, front.}\\[10mm]
\raggedright
{\small\color{black!70} ${pages} pages${8 * sheets > pages ? `, with ${8 * sheets - pages} blank at the end` : ""}.
If the backs of the pages come out upside down, print again flipping on the \emph{short} edge:
printers don't all agree on which edge is which for a sheet printed sideways.\par}
\end{minipage}`;
}
