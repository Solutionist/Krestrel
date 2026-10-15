import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DisplayCurrency } from "~/hooks/use-currency";
import { formatMoney } from "~/lib/currency";
import type { ReceivedDividend } from "~/lib/dividends-received";
import type { Trade } from "~/lib/portfolio";

import { TaxReportPanel } from "./tax-report-panel";

function display(currency: string, rate: number): DisplayCurrency {
  return {
    currency,
    selected: currency,
    setCurrency: () => {},
    fx: {
      status: "ready",
      fx: { rates: { USD: 1, [currency]: rate }, date: "2026-10-14", source: "ECB" },
    },
    convert: (usd) => usd * rate,
    money: (usd, signed) => formatMoney(usd * rate, currency, signed),
  };
}

function trade(
  id: string,
  side: Trade["side"],
  shares: number,
  price: number,
  tradedOn: string,
): Trade {
  return {
    id,
    portfolioId: "p1",
    symbol: "AAPL",
    side,
    shares,
    price,
    fee: 0,
    tradedOn,
    createdAt: `${tradedOn}T12:00:00Z`,
  };
}

const TRADES = [trade("b", "buy", 10, 100, "2024-03-01"), trade("s", "sell", 4, 125, "2024-03-04")];
const RECEIVED: ReceivedDividend[] = [
  {
    portfolioId: "p1",
    symbol: "AAPL",
    exDate: "2024-05-10",
    payDate: "2024-05-16",
    shares: 6,
    perShare: 0.25,
    cash: 1.5,
    overridden: false,
  },
];

afterEach(() => vi.unstubAllGlobals());

describe("TaxReportPanel", () => {
  it("shows USD without asking for past rates, with ▲ on gains and … while dividends load", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <TaxReportPanel
        trades={TRADES}
        received={undefined}
        receivedError={null}
        display={display("USD", 1)}
      />,
    );

    const row = screen.getByRole("row", { name: /2024/ });
    expect(row).toHaveTextContent("$500.00");
    expect(row).toHaveTextContent("$400.00");
    expect(row).toHaveTextContent("▲ +$100.00");
    expect(row).toHaveTextContent("…");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("converts each sell and dividend at its own date's rate, and lists the year's sells", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/api/fx/history?quote=THB&from=2024-03-01");
      // 2024-03-02/03 are a weekend: the sell on Monday uses Monday's rate, the buy Friday's.
      return Response.json({
        ok: true,
        quote: "THB",
        rates: { "2024-03-01": 35, "2024-03-04": 36, "2024-05-16": 37 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <TaxReportPanel
        trades={TRADES}
        received={RECEIVED}
        receivedError={null}
        display={display("THB", 33)}
      />,
    );

    const row = await screen.findByRole("row", { name: /2024/ });
    expect(row).toHaveTextContent(formatMoney(500 * 36, "THB")); // proceeds
    expect(row).toHaveTextContent(formatMoney(400 * 35, "THB")); // cost
    expect(row).toHaveTextContent(formatMoney(4000, "THB", true)); // realized
    expect(row).toHaveTextContent(formatMoney(1.5 * 37, "THB")); // dividends

    fireEvent.click(screen.getByRole("button", { name: /2024/ }));
    expect(screen.getByRole("table", { name: "Sells in 2024" })).toHaveTextContent("36 THB/USD");
    expect(screen.getByText(/In USD the realized P\/L was \+\$100\.00/)).toBeInTheDocument();
  });

  it("falls back to USD with a message when past rates can't be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            ok: false,
            error: { code: "unavailable", message: "Couldn't load past exchange rates." },
          },
          { status: 502 },
        ),
      ),
    );
    render(
      <TaxReportPanel
        trades={TRADES}
        received={[]}
        receivedError={null}
        display={display("EUR", 0.9)}
      />,
    );

    expect(await screen.findByText("Couldn't load past exchange rates.")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /2024/ })).toHaveTextContent("▲ +$100.00");
  });
});

describe("TaxReportPanel edge cases", () => {
  it("says why dividends are missing when they can't be loaded, instead of loading forever", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(
      <TaxReportPanel
        trades={TRADES}
        received={undefined}
        receivedError="Couldn't load dividends received."
        display={display("USD", 1)}
      />,
    );
    expect(screen.getByText(/Couldn't load dividends received\./)).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /2024/ })).not.toHaveTextContent("…");
  });

  it("asks for rates from 1999 when a trade is older, and still converts it", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/api/fx/history?quote=SEK&from=1999-01-01");
      return Response.json({ ok: true, quote: "SEK", rates: { "1999-01-04": 8 } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <TaxReportPanel
        trades={[trade("b", "buy", 1, 100, "1998-06-01"), trade("s", "sell", 1, 150, "1998-07-01")]}
        received={[]}
        receivedError={null}
        display={display("SEK", 9)}
      />,
    );
    const row = await screen.findByRole("row", { name: /1998/ });
    expect(row.textContent).toContain(formatMoney(150 * 8, "SEK")); // proceeds at the first rate
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
