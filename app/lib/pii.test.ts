import { describe, expect, it } from "vitest";

import { ocrLineVerdict, redactPii } from "./pii";

describe("redactPii", () => {
  it.each([
    ["email", "Mail jane.doe+krestrel@example.co.uk today", "Mail [redacted email] today"],
    ["phone", "Call 212-555-0123.", "Call [redacted phone]."],
    ["phone", "Line +66 81 234 5678 is mine", "Line [redacted phone] is mine"],
    ["ssn", "SSN 123-45-6789, thanks", "SSN [redacted ssn], thanks"],
    ["card", "Card 4111 1111 1111 1111.", "Card [redacted card]."],
    ["card", "Card 4111111111111111, ok", "Card [redacted card], ok"],
    ["iban", "IBAN GB82 WEST 1234 5698 7654 32 here", "IBAN [redacted iban] here"],
    ["account", "Account: 1234-5678 closed", "[redacted account] closed"],
    ["account", "Acct # ****1234", "[redacted account]"],
  ])("redacts a %s and counts it", (kind, text, redacted) => {
    expect(redactPii(text)).toEqual({ text: redacted, found: { [kind]: 1 } });
  });

  it("redacts a card at the end of a sentence whole, not as a phone with digits left over", () => {
    expect(redactPii("pay with 4111 1111 1111 1111.").text).toBe("pay with [redacted card].");
  });

  it("leaves numbers that fail their checksum alone", () => {
    expect(redactPii("code DE00 ABCD EFGH IJKL MNOP QR x").found).toEqual({});
    expect(redactPii("ref 4111111111111112 x").found).toEqual({});
  });

  it("never touches market data: prices, big amounts, volumes, timestamps, dates, percentages", () => {
    const market =
      "Revenue 391,035,000,000 rose 2.0%; last 209.828486, vol 13553391 at 1729051200 (ms 1792047214349) on 2026-10-15; range 119.50-121.25";
    expect(redactPii(market)).toEqual({ text: market, found: {} });
  });

  it("ignores 'account' in prose when no identifier follows", () => {
    expect(redactPii("Services account for 20% of revenue").found).toEqual({});
  });
});

describe("ocrLineVerdict (what of a screenshot line Claude may see)", () => {
  it("keeps a holdings row but hides its company name", () => {
    expect(ocrLineVerdict(["AAPL", "Apple", "Inc.", "12", "$182.40"])).toEqual({
      keep: true,
      maskWords: [1, 2],
    });
  });

  it("keeps a lone ticker (card layouts) and a currency mark printed apart from the amount", () => {
    expect(ocrLineVerdict(["AAPL"]).keep).toBe(true);
    expect(ocrLineVerdict(["KO", "30", "฿", "61.20"])).toEqual({ keep: true, maskWords: [] });
  });

  it("keeps a header row even when one column is called Name", () => {
    expect(ocrLineVerdict(["Name", "Qty", "Avg", "cost"])).toEqual({ keep: true, maskWords: [] });
  });

  it("never lets a header-like line carry a name or a personal label to Claude", () => {
    // Two column words and no number made these "headers", shown whole before.
    expect(ocrLineVerdict(["Account", "holder:", "Jane", "Doe", "Total", "value"]).keep).toBe(
      false,
    );
    expect(ocrLineVerdict(["Jane", "Doe", "Total", "Value"])).toEqual({
      keep: true,
      maskWords: [0, 1],
    });
  });

  it("shows only the amount of a greeting with a balance", () => {
    expect(ocrLineVerdict(["Hi", "Jane", "Doe", "$92,064.61"])).toEqual({
      keep: true,
      maskWords: [0, 1, 2],
    });
  });

  it.each([
    [["Jane", "Doe"]],
    [["jane@example.com"]],
    [["Account", "1234-5678"]],
    [["Account", "holder", "Jane", "Doe", "12"]],
    [["Ref", "1234", "5678", "9012"]],
    [["Phone", "081", "234", "5678"]],
    [["ID:", "88123", "$5.00"]],
    [["Sort", "code", "12-34-56"]],
    // Upper-case labels look like tickers, but without a price on the line they are labels.
    [["PHONE", "555", "1234"]],
    [["TEL", "555", "1234"]],
    [["SSN", "123", "45", "6789"]],
    [["DOB", "15", "03", "1985"]],
    [["ID", "456789"]],
  ])("drops %j", (words) => {
    expect(ocrLineVerdict(words).keep).toBe(false);
  });

  it("hides a long bare reference number inside a kept row", () => {
    expect(ocrLineVerdict(["AAPL", "12", "88812345"]).maskWords).toEqual([2]);
  });

  it("keeps holdings whose ticker or company name looks like a field label (TEL, T-Mobile)", () => {
    expect(ocrLineVerdict(["TEL", "10", "$1,500.00"]).keep).toBe(true);
    expect(ocrLineVerdict(["TEL"]).keep).toBe(true);
    const tmobile = ocrLineVerdict(["TMUS", "T-Mobile", "US", "12", "$2,345.67"]);
    expect(tmobile.keep).toBe(true);
    // The company name is still hidden; the ticker and numbers stay.
    expect(tmobile.maskWords).toEqual([1]);
  });
});
