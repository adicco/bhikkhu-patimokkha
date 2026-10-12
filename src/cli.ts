/** Command-line parsing for the scripts: parseArgs with --help and readable errors instead of stack traces. */
import { parseArgs, type ParseArgsConfig } from "node:util";

type Options = NonNullable<ParseArgsConfig["options"]>;

/** Print `message` and a pointer to --help, then exit with status 2 (bad usage). */
export function usageError(name: string, message: string): never {
  console.error(`${name}: ${message}\nRun 'bun ${name} --help' for usage.`);
  process.exit(2);
}

/** "a, b or c" */
export const orList = (xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}` : xs.join(""));

/** Levenshtein distance, for "did you mean" suggestions. */
function distance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length]!;
}

/** The closest of `choices` to `word`, if any is close enough to be a likely typo. */
export function suggest(word: string, choices: readonly string[]) {
  const ranked = choices
    .map((c) => ({ c, d: c.startsWith(word) || word.startsWith(c) ? Math.min(1, distance(word, c)) : distance(word, c) }))
    .sort((x, y) => x.d - y.d);
  const best = ranked[0];
  return best && best.d <= Math.max(1, Math.floor(word.length / 3)) ? best.c : undefined;
}

/**
 * parseArgs, plus: `--help`/`-h` prints `help` and exits; unknown options, missing values and the
 * like print one line (with a suggestion for likely typos) and exit 2.
 */
export function parseCli<T extends Options, P extends boolean = false>(name: string, help: string, options: T, allowPositionals?: P) {
  const argv = Bun.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(help.trim());
    process.exit(0);
  }
  try {
    return parseArgs({ args: argv, options, allowPositionals: (allowPositionals ?? false) as P, strict: true });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (!err.code?.startsWith("ERR_PARSE_ARGS")) throw e;
    const unknown = err.message.match(/Unknown option '(-+)([^'=]+)/);
    if (unknown) {
      const guess = suggest(unknown[2]!, Object.keys(options));
      usageError(name, `unknown option ${unknown[1]}${unknown[2]}${guess ? ` (did you mean --${guess}?)` : ""}`);
    }
    const missing = err.message.match(/Option '(-[^ ']*(?:, -[^ ']*)?)(?: <value>)?' argument (?:missing|is ambiguous)/);
    if (missing) usageError(name, `${missing[1]!.split(", ").pop()} needs a value`);
    const noValue = err.message.match(/Option '(-[^ ']*(?:, -[^ ']*)?)' does not take an argument/);
    if (noValue) usageError(name, `${noValue[1]!.split(", ").pop()} is a switch and takes no value`);
    const positional = err.message.match(/Unexpected argument '([^']+)'/);
    if (positional) usageError(name, `unexpected argument '${positional[1]}'`);
    usageError(name, err.message.split(". ")[0]!);
  }
}
