/** What a build includes. Every target (md, html, epub, pdf) takes the same options. */
export interface Show {
  /** Pāli text */
  pali: boolean;
  /** English translation */
  english: boolean;
  /** English rubrics/instructions for group uposatha, pavāraṇā etc. */
  instructions: boolean;
  /** The Preliminary Duties notes chapter and inline notes */
  notes: boolean;
  /** Replace readings marked {% sic %} with the suggested correction */
  corrections: boolean;
}

export type Lang = "pali" | "english" | "both";

export function showFor(lang: Lang, overrides: Partial<Show> = {}): Show {
  const pali = lang !== "english";
  const english = lang !== "pali";
  return {
    pali,
    english,
    instructions: english,
    notes: english,
    corrections: true,
    ...overrides,
  };
}
