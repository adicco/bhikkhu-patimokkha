/**
 * Uposatha days from data/mahanikaya.csv (Splendid Moons' Mahānikāya calendar, 2000–2100).
 * Each day gives the season, which uposatha of the season it is, whether the season has an
 * additional month (10 uposathas instead of 8) and whether it falls on the 14th or 15th.
 * Communities that reckon the calendar differently can override any of these in the form.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Occasion } from "./occasion";

export interface UposathaDay {
  date: string;
  moon: "new" | "full";
  season: NonNullable<Occasion["season"]>;
  fortnight: number;
  adhika: boolean;
  day: "fourteenth" | "fifteenth";
  pavarana: boolean;
}

const SEASONS: Record<string, UposathaDay["season"]> = { Hemanta: "hemanta", Gimha: "gimha", "Vassāna": "vassana" };

export function uposathaDays(file = join(import.meta.dir, "..", "data", "mahanikaya.csv")): UposathaDay[] {
  const [header, ...rows] = readFileSync(file, "utf8").normalize("NFC").trim().split(/\r?\n/);
  const cols = header!.split(",");
  const at = (name: string) => cols.indexOf(name);
  const byDate = new Map<string, UposathaDay>();
  for (const row of rows) {
    const f = row.split(",");
    const phase = f[at("phase")];
    const season = SEASONS[f[at("season")]!];
    if ((phase !== "new" && phase !== "full") || !season) continue;
    const date = f[at("date")]!;
    const day = byDate.get(date) ?? {
      date,
      moon: phase,
      season,
      fortnight: Number(f[at("season_number")]),
      adhika: Number(f[at("season_total")]) === 10,
      day: f[at("days")] === "14" ? "fourteenth" : "fifteenth",
      pavarana: false,
    };
    if (f[at("label")] === "pavarana") day.pavarana = true;
    byDate.set(date, day);
  }
  return [...byDate.values()];
}
