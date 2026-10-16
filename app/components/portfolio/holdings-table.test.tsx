import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChangePill } from "./holdings-table";

describe("ChangePill", () => {
  it("pairs the colour with a ▼ and screen-reader text for a loss", () => {
    const { container } = render(<ChangePill value={-5} fraction={-0.05} />);
    expect(container.textContent).toContain("▼ down");
  });
});
