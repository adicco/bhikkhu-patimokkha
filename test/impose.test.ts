import { expect, test } from "bun:test";
import { a6Sheets, a6Side } from "../src/impose";

/**
 * Makes up the A6 booklet as the guide sheet says: cut every sheet down the middle, put the
 * right-hand pile under the left-hand one, fold the lot (top leaf outermost), and read it.
 */
function readBooklet(sheets: number) {
  type Leaf = { front: [number, number]; back: [number, number] };
  const half = (s: number, h: 0 | 1): Leaf => ({ front: a6Side(s, sheets, false)[h], back: a6Side(s, sheets, true)[h] });
  const left = Array.from({ length: sheets }, (_, s) => half(s, 0));
  const right = Array.from({ length: sheets }, (_, s) => half(s, 1));
  const leaves = [...left, ...right];
  // Each half reads as a spread [left page, right page]. Through the first half of the booklet
  // each leaf gives its front's right page, then its back's left page; coming back out, its
  // back's right page, then its front's left page.
  return [
    ...leaves.flatMap((l) => [l.front[1], l.back[0]]),
    ...leaves.reverse().flatMap((l) => [l.back[1], l.front[0]]),
  ];
}

test("the A6 booklet, cut, stacked right under left and folded, reads in page order", () => {
  for (const sheets of [1, 2, 3, 7, 27]) {
    expect(readBooklet(sheets)).toEqual(Array.from({ length: 8 * sheets }, (_, i) => i + 1));
  }
});

test("A6 sheets: eight pages to a sheet of A4, rounded up", () => {
  expect([1, 8, 9, 16, 17, 209].map(a6Sheets)).toEqual([1, 1, 2, 2, 3, 27]);
});
