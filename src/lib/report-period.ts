import { todayRiyadh } from "./mutabee";

const pad = (n: number) => String(n).padStart(2, "0");
export type Period = "month" | "last" | "3m" | "year" | "all" | "custom";
export const PERIODS: [Period, string][] = [["month", "هذا الشهر"], ["last", "الشهر الماضي"], ["3m", "آخر 3 أشهر"], ["year", "هذه السنة"], ["all", "كل الفترات"], ["custom", "فترة مخصّصة"]];

/** Date range (inclusive, Riyadh calendar) for a period preset. `today` is injectable for tests. */
export function periodRange(p: Period, custom: { from: string; to: string }, today: string = todayRiyadh()): { from: string | null; to: string | null } {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const first = (yy: number, mm: number) => `${yy}-${pad(mm)}-01`;
  const last = (yy: number, mm: number) => `${yy}-${pad(mm)}-${pad(new Date(Date.UTC(yy, mm, 0)).getUTCDate())}`;
  const shift = (k: number): [number, number] => { const i = y * 12 + (m - 1) + k; return [Math.floor(i / 12), (i % 12) + 1]; };
  if (p === "month") return { from: first(y, m), to: last(y, m) };
  if (p === "last") { const [yy, mm] = shift(-1); return { from: first(yy, mm), to: last(yy, mm) }; }
  if (p === "3m") { const [yy, mm] = shift(-2); return { from: first(yy, mm), to: last(y, m) }; }
  if (p === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (p === "custom") return { from: custom.from || null, to: custom.to || null };
  return { from: null, to: null };
}
