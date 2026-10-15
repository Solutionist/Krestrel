import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AlertBar } from "./alert-bar";

function renderBar(onCreate = vi.fn(async () => true)) {
  render(
    <AlertBar
      symbol="AAPL"
      lastPrice={190.5}
      alerts={[]}
      error={null}
      onCreate={onCreate}
      onRemove={() => {}}
    />,
  );
  return onCreate;
}

describe("AlertBar", () => {
  it("prefills the last price and creates the alert in the chosen direction", async () => {
    const onCreate = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Set alert" }));
    const price = screen.getByLabelText("Alert price in US dollars");
    expect(price).toHaveValue(190.5);

    fireEvent.change(price, { target: { value: "185.25" } });
    fireEvent.click(screen.getByRole("button", { name: "Price falls to or below" }));
    fireEvent.click(screen.getByRole("button", { name: "Create alert" }));

    await waitFor(() => expect(screen.queryByLabelText("Alert price in US dollars")).toBeNull());
    expect(onCreate).toHaveBeenCalledWith({ symbol: "AAPL", direction: "below", price: 185.25 });
  });

  it("warns when the price is already past the target and blocks an empty price", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Set alert" }));
    const price = screen.getByLabelText("Alert price in US dollars");

    fireEvent.change(price, { target: { value: "180" } });
    expect(screen.getByText(/already above this, so it fires on the next trade/)).toBeVisible();

    fireEvent.change(price, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Create alert" })).toBeDisabled();
  });

  it("blocks a price below the 0.0001 the database can store", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Set alert" }));
    fireEvent.change(screen.getByLabelText("Alert price in US dollars"), {
      target: { value: "0.00004" },
    });

    expect(screen.getByRole("button", { name: "Create alert" })).toBeDisabled();
  });
});
