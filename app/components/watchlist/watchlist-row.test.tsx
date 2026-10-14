import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WatchlistRow } from "./watchlist-row";

const quote = (lastPrice: number | null, previousClose: number | null) => ({
  symbol: "AAPL",
  lastPrice,
  lastTs: lastPrice === null ? null : 1,
  previousClose,
});

describe("WatchlistRow", () => {
  it("shows the price with a ▲ glyph, signed change, and percent for a gain", () => {
    const { container } = render(<WatchlistRow quote={quote(189.06, 187.81)} />);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("189.06")).toBeInTheDocument();
    expect(container).toHaveTextContent("▲ +1.25 +0.67%");
    expect(screen.getByText("up +0.67%")).toHaveClass("sr-only");
  });

  it("uses ▼ and a true minus sign for a loss, never colour alone", () => {
    const { container } = render(<WatchlistRow quote={quote(310.37, 312)} />);
    expect(container).toHaveTextContent("▼ \u22121.63 \u22120.52%");
    expect(screen.getByText("down \u22120.52%")).toBeInTheDocument();
  });

  it("keeps 4 decimals for sub-dollar stocks", () => {
    const { container } = render(<WatchlistRow quote={quote(0.5123, 0.5)} />);
    expect(screen.getByText("0.5123")).toBeInTheDocument();
    expect(container).toHaveTextContent("▲ +0.0123 +2.46%");
  });

  it("shows placeholders until the first price or previous close arrives", () => {
    render(<WatchlistRow quote={quote(null, null)} />);
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.getByText("no change data yet")).toBeInTheDocument();
  });
});
