// Personal data rules for anything sent to Claude (ADR 0021). Shared by the server's outbound text
// guard (`redactPii`, in the Claude client) and the browser's screenshot mask (`ocrLineVerdict`).
// Patterns are high-confidence and checksum-validated where a checksum exists, so prices, share
// counts, volumes, dates and epoch timestamps in prompts are never touched.

export const PII_KINDS = ["email", "phone", "ssn", "card", "iban", "account"] as const;
export type PiiKind = (typeof PII_KINDS)[number];

/** Luhn checksum (payment cards). */
function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** ISO 13616 mod-97 check (IBANs). */
function ibanValid(raw: string): boolean {
  const iban = raw.replace(/\s/g, "").toUpperCase();
  if (iban.length < 15 || iban.length > 34) return false;
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const char of rearranged) {
    const value = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/**
 * Where a valid card number sits in a card-pattern match: the widest run of whole digit groups
 * (by characters, earliest on a tie) with 13–19 digits that passes Luhn and is either grouped or
 * 15/16 contiguous digits (epoch ms is 13, volumes far less). Finds "4111111111111111" in
 * "4111111111111111 123", where the whole match fails the checksum.
 */
function cardSpan(match: string): readonly [number, number] | null {
  const groups = [...match.matchAll(/\d+/g)].map((group) => ({
    start: group.index,
    end: group.index + group[0].length,
    digits: group[0],
  }));
  let best: readonly [number, number] | null = null;
  for (let first = 0; first < groups.length; first++) {
    let digits = "";
    for (let last = first; last < groups.length; last++) {
      digits += groups[last]?.digits ?? "";
      if (digits.length > 19) break;
      if (digits.length < 13 || !luhnValid(digits)) continue;
      if (last === first && digits.length !== 15 && digits.length !== 16) continue;
      const start = groups[first]?.start ?? 0;
      const end = groups[last]?.end ?? 0;
      if (!best || end - start > best[1] - best[0]) best = [start, end];
    }
  }
  return best;
}

/**
 * Each kind's pattern plus an optional `locate`, which returns the part of the match to replace
 * (null keeps it all; without `locate` the whole match goes). Order matters: earlier kinds are
 * replaced first, so a card number isn't half-eaten by the phone pattern. Number patterns refuse
 * to start or end inside a longer number ("12.4111…", "…1111.5"), but a sentence's full stop or
 * comma after a number is fine.
 */
const RULES: ReadonlyArray<{
  kind: PiiKind;
  pattern: RegExp;
  locate?: (match: string) => readonly [number, number] | null;
}> = [
  { kind: "email", pattern: /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi },
  {
    kind: "iban",
    pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g,
    locate: (match) => (ibanValid(match) ? [0, match.length] : null),
  },
  {
    kind: "card",
    pattern: /(?<!\d|\d[.,])\d(?:[ -]?\d){12,18}(?!\d|[.,]\d)/g,
    locate: cardSpan,
  },
  { kind: "ssn", pattern: /(?<!\d|\d[.,-])\d{3}-\d{2}-\d{4}(?![\d-]|[.,]\d)/g },
  {
    // Needs two separators: "212-555-0123", "(02) 123 4567", "+66 81 234 5678", "081.234.5678".
    kind: "phone",
    pattern:
      /(?<!\w|\d[.,])(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?|\d{2,4}[ .-])\d{3,4}[ .-]\d{4}(?!\w|[.,]\d)/g,
  },
  {
    // Only when labelled, e.g. "Account: 1234-5678", "Acct # ****1234", "A/C no. 98765".
    kind: "account",
    pattern:
      /\b(?:account|acct|a\/c)(?:[ \t]*(?:no\.?|number|#|id))?[ \t]*[:#]?[ \t]*(?=[A-Z0-9*•x-]*\d)[A-Z0-9*•x-]{4,}/gi,
  },
];

export interface Redaction {
  text: string;
  /** How many items of each kind were replaced; never the values. */
  found: Partial<Record<PiiKind, number>>;
}

/** Replaces personal data in free text with `[redacted <kind>]`. */
export function redactPii(text: string): Redaction {
  const found: Partial<Record<PiiKind, number>> = {};
  let result = text;
  for (const { kind, pattern, locate } of RULES) {
    result = result.replace(pattern, (match) => {
      const span = locate ? locate(match) : [0, match.length];
      if (!span) return match;
      found[kind] = (found[kind] ?? 0) + 1;
      return `${match.slice(0, span[0])}[redacted ${kind}]${match.slice(span[1])}`;
    });
  }
  return { text: result, found };
}

/** Labels of personal fields on broker screens, matched word by word; a line carrying one is never sent. */
const PERSONAL_LABELS = new Set([
  "name",
  "account",
  "acct",
  "a/c",
  "email",
  "e-mail",
  "phone",
  "mobile",
  "tel",
  "address",
  "holder",
  "owner",
  "client",
  "customer",
  "member",
  "user",
  "username",
  "login",
  "id",
  "dob",
  "birth",
  "ssn",
  "tax",
  "tin",
  "passport",
  "iban",
  "swift",
  "routing",
]);

/** Column header words; a line of two or more is a header row, kept so the reader knows the columns. */
const COLUMN_WORD =
  /^(?:symbol|ticker|stock|shares?|qty|quantity|units|avg\.?|average|cost|price|value|market|holdings?|positions?|gain|loss|return|p\/l|weight|last|change|equity|total|today|day|%)$/i;

const TICKER = /^[A-Z]{1,5}(?:[./-][A-Z]{1,2})?$/;
const CURRENCY_MARKS = /[$€£¥฿₹₩₫₱₪₺₽¢]/g;

function isNumberToken(word: string): boolean {
  const bare = word.replace(CURRENCY_MARKS, "").replace(/^[-+(]+|[)%]+$/g, "");
  return /^\d[\d,]*(?:\.\d+)?$/.test(bare) || /^\d*\.\d+$/.test(bare);
}

/** A long bare digit run (account or reference number) inside an otherwise useful line. */
function isIdentifierToken(word: string): boolean {
  const bare = word.replace(/[-]/g, "");
  return /^\d{7,}$/.test(bare);
}

/**
 * Whether `word` labels a personal field. A hyphenated name (T-Mobile) is not its parts, and
 * "ID:" with a colon always is. A ticker-shaped word (TEL, ID) counts as a symbol, not a label,
 * only where a symbol is expected (`symbolLine`: a priced holdings row or a lone ticker card);
 * elsewhere "PHONE 555 1234" or "SSN 123 45 6789" is a label with its value.
 */
function isPersonalLabel(word: string, next: string | undefined, symbolLine: boolean): boolean {
  if (symbolLine && TICKER.test(word)) return false;
  const core = word.toLowerCase().replace(/[:#.,]+$/, "");
  return PERSONAL_LABELS.has(core) || (core === "sort" && /^code\b/i.test(next ?? ""));
}
export interface LineVerdict {
  keep: boolean;
  /** Indexes of words to black out inside a kept line. */
  maskWords: number[];
}

/**
 * Whether one OCR line of a broker screenshot may be shown to Claude. Kept: holdings rows (a
 * number, or a lone ticker on card layouts) and header rows. Dropped: anything with personal
 * data, a personal-field label, or prose. Inside a kept row only numbers, tickers and column words
 * stay visible, so company names, and any name beside an amount ("Hi Jane · $92,064"), are hidden.
 */
export function ocrLineVerdict(words: readonly string[]): LineVerdict {
  const text = words.join(" ");
  const drop = { keep: false, maskWords: [] };
  if (words.length === 0) return drop;
  if (Object.keys(redactPii(text).found).length > 0) return drop;
  // Grouped digit blocks ("1234 5678", "1234-5678-9012") are reference numbers, not amounts.
  if (/(?<![\d.,])\d{4}[ -]\d{4}(?:[ -]\d{2,4})*(?![\d.,])/.test(text)) return drop;

  const columnWords = words.filter((word) => COLUMN_WORD.test(word)).length;
  const numbers = words.filter(isNumberToken).length;
  const tickers = words.filter((word) => TICKER.test(word)).length;
  const header = columnWords >= 2 && numbers === 0;
  const loneTicker = tickers === 1 && words.length <= 2;
  // A price (currency mark or decimal amount) marks a holdings row, where a ticker is expected.
  const priced = words.some(
    (word) =>
      isNumberToken(word) && (word.replace(CURRENCY_MARKS, "") !== word || /\d\.\d/.test(word)),
  );
  // A header row may title a column "Name"; every other personal label drops the line, headers
  // included ("Account holder: Jane Doe · Total value"). Without a price, only a ticker standing
  // alone counts as a symbol: "ID 456789" is a label and its value.
  const labelled = words.some(
    (word, index) =>
      isPersonalLabel(word, words[index + 1], priced || words.length === 1) &&
      !(header && /^name:?$/i.test(word)),
  );
  if (labelled) return drop;
  if (!header && numbers === 0 && !loneTicker) return drop;

  // What stays readable: in a header only the column titles; in a row the numbers, tickers,
  // column words and currency marks. Everything else (names, company names) is blacked out.
  const visible = (word: string) =>
    header
      ? COLUMN_WORD.test(word) || /^name:?$/i.test(word)
      : !isIdentifierToken(word) &&
        (isNumberToken(word) ||
          TICKER.test(word) ||
          COLUMN_WORD.test(word) ||
          word.replace(CURRENCY_MARKS, "") === "");
  return {
    keep: true,
    maskWords: words.flatMap((word, index) => (visible(word) ? [] : [index])),
  };
}
