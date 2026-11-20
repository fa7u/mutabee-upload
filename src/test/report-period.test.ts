import { describe, expect, it } from "vitest";

import { periodRange } from "@/lib/report-period";

const none = { from: "", to: "" };
describe("periodRange", () => {
  it("this month / last month", () => {
    expect(periodRange("month", none, "2026-11-19")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(periodRange("last", none, "2026-11-19")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
  it("crosses the year boundary and handles leap February", () => {
    expect(periodRange("last", none, "2026-01-05")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodRange("3m", none, "2026-01-05")).toEqual({ from: "2025-11-01", to: "2026-01-31" });
    expect(periodRange("month", none, "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
  it("year / all / custom", () => {
    expect(periodRange("year", none, "2026-11-19")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(periodRange("all", none, "2026-11-19")).toEqual({ from: null, to: null });
    expect(periodRange("custom", { from: "2026-03-01", to: "" }, "2026-11-19")).toEqual({ from: "2026-03-01", to: null });
  });
});
