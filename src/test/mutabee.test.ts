import { describe, it, expect } from "vitest";
import { DEFAULT_STATUSES, distribute, mergeImportRow, parseAmount, withDefaultStatuses } from "@/lib/mutabee";

describe("parseAmount", () => {
  it("reads Arabic digits and thousand separators", () => {
    expect(parseAmount("١٬٢٣٤٫٥")).toBe(1234.5);
  });
  it("treats parentheses as negative", () => {
    expect(parseAmount("(500)")).toBe(-500);
  });
  it("returns NaN for empty values", () => {
    expect(parseAmount("")).toBeNaN();
  });
});

describe("statuses", () => {
  it("includes the لا يرد status, open and unpaid", () => {
    const s = DEFAULT_STATUSES.find((x) => x.name === "لا يرد");
    expect(s).toBeDefined();
    expect(s!.closed).toBe(false);
    expect(s!.paid).toBe(false);
  });
  it("withDefaultStatuses adds missing defaults to an existing project list", () => {
    const old = DEFAULT_STATUSES.filter((s) => s.id !== "s_noreply");
    const merged = withDefaultStatuses(old);
    expect(merged.some((s) => s.id === "s_noreply")).toBe(true);
    expect(merged.length).toBe(DEFAULT_STATUSES.length);
  });
});

describe("distribute", () => {
  it("keeps claim counts within one of each other, counting existing load", () => {
    const claims = Array.from({ length: 10 }, (_, i) => ({ id: "c" + i, amount: (i + 1) * 100 }));
    const plan = distribute(claims, [{ uid: "a", count: 3 }, { uid: "b" }, { uid: "c" }]);
    const n = { a: 3, b: 0, c: 0 } as Record<string, number>;
    Object.values(plan).forEach((u) => (n[u] = (n[u] ?? 0) + 1));
    const v = Object.values(n) as number[];
    expect(Math.max(...v) - Math.min(...v)).toBeLessThanOrEqual(1);
    expect(Object.keys(plan)).toHaveLength(10);
  });
});

describe("mergeImportRow", () => {
  it("keeps columns the file does not contain (values staff typed into added columns)", () => {
    const { merged, changed } = mergeImportRow({ "الاسم": "أحمد", "رقم الجوال": "0555" }, { "الاسم": "أحمد", "المبلغ": "100" });
    expect(merged).toEqual({ "الاسم": "أحمد", "رقم الجوال": "0555", "المبلغ": "100" });
    expect(changed).toBe(true); // the file brings a column the row did not have yet
  });
  it("lets file columns overwrite stored values and reports the change", () => {
    const { merged, changed } = mergeImportRow({ "المبلغ": "100", "جوال": "0555" }, { "المبلغ": "250" });
    expect(merged).toEqual({ "المبلغ": "250", "جوال": "0555" });
    expect(changed).toBe(true);
  });
  it("reports no change when every file column already matches, even if the row has extra columns", () => {
    const { merged, changed } = mergeImportRow({ "المبلغ": "100", "جوال": "0555" }, { "المبلغ": "100" });
    expect(merged).toEqual({ "المبلغ": "100", "جوال": "0555" });
    expect(changed).toBe(false);
  });
  it("treats a missing stored value like an empty one", () => {
    expect(mergeImportRow({}, { "ملاحظة": "" }).changed).toBe(false);
    expect(mergeImportRow(null, { "ملاحظة": "x" }).changed).toBe(true);
  });
  it("never mutates the stored data", () => {
    const stored = { a: "1" };
    mergeImportRow(stored, { a: "2", b: "3" });
    expect(stored).toEqual({ a: "1" });
  });
});
