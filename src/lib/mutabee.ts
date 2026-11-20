// Pure helpers ported from the original app (no backend calls) — testable

export type Role = "owner" | "exec" | "supervisor" | "employee";
export type Status = { id: string; name: string; color: string; closed: boolean; paid: boolean; parent?: string };

export const ROLE_LABEL: Record<Role, string> = {
  owner: "مالك النظام",
  exec: "المدير التنفيذي",
  supervisor: "مشرف",
  employee: "موظف",
};

export const DEFAULT_STATUSES: Status[] = [
  { id: "s_new", name: "جديد", color: "#64748b", closed: false, paid: false },
  { id: "s_contacted", name: "تم التواصل", color: "#2563eb", closed: false, paid: false },
  { id: "s_promise", name: "وعد بالسداد", color: "#d97706", closed: false, paid: false },
  { id: "s_refused", name: "رفض", color: "#dc2626", closed: false, paid: false },
  { id: "s_noreply", name: "لا يرد", color: "#8b5cf6", closed: false, paid: false },
  { id: "s_paid", name: "تم السداد", color: "#16a34a", closed: true, paid: true },
];

/** Appends any DEFAULT_STATUSES missing from a project's stored list (existing projects get new defaults automatically). */
export function withDefaultStatuses(statuses: Status[]): Status[] {
  const have = new Set((statuses || []).map((s) => s.id));
  return [...(statuses || []), ...DEFAULT_STATUSES.filter((s) => !have.has(s.id))];
}

const AR = "٠١٢٣٤٥٦٧٨٩";
const FA = "۰۱۲۳۴۵۶۷۸۹";

export function normDigits(s: unknown): string {
  return String(s)
    .replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)))
    .replace(/[٬،]/g, ",")
    .replace(/٫/g, ".");
}

/** Returns a number, or NaN when the value is empty / not understood. */
export function parseAmount(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : NaN;
  if (v == null) return NaN;
  let s = normDigits(v).trim();
  if (!s) return NaN;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/[^0-9.,]/g, "").replace(/,/g, "");
  if (!s) return NaN;
  const n = parseFloat(s);
  if (!isFinite(n)) return NaN;
  return neg ? -n : n;
}

export function sanitizeHeaders(arr: unknown[]): string[] {
  const seen = new Map<string, number>();
  return arr.map((h, i) => {
    let s = String(h ?? "").replace(/[.\/\[\]*`~]/g, " ").replace(/\s+/g, " ").trim();
    if (!s) s = "عمود " + (i + 1);
    const n = (seen.get(s) || 0) + 1;
    seen.set(s, n);
    return n > 1 ? `${s} (${n})` : s;
  });
}

export async function hashStr(s: string): Promise<string> {
  const b = new TextEncoder().encode(s);
  const d = await crypto.subtle.digest("SHA-256", b);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

export function todayRiyadh(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(toYmd) - Date.parse(fromYmd)) / 864e5);
}

/**
 * Re-importing a row that already exists: columns present in the file overwrite the stored values,
 * every other stored column (values staff typed into columns added later, for example) is kept.
 * `changed` tells whether any column in the file differs from what is stored.
 */
export function mergeImportRow(
  existing: Record<string, string> | null | undefined,
  row: Record<string, string>,
): { merged: Record<string, string>; changed: boolean } {
  const old = existing || {};
  const changed = Object.keys(row).some((k) => (old[k] ?? "") !== (row[k] ?? ""));
  return { merged: { ...old, ...row }, changed };
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function money(n: unknown): string {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Distributes unassigned claims across employees:
 *  - count: difference between any two employees never exceeds one (counting existing load)
 *  - amount: biggest claims first, each goes to the lowest-sum among lowest-count employees
 *  - randomness: near-equal amounts shuffled, random pick among close candidates
 * Never touches already-assigned claims. Returns { [claimId]: uid }.
 */
export function distribute(
  claims: { id: string; amount: number }[],
  emps: { uid: string; count?: number; sum?: number }[],
  rng: () => number = Math.random,
): Record<string, string> {
  const E = emps.map((e) => ({ uid: e.uid, count: e.count || 0, sum: e.sum || 0 }));
  const out: Record<string, string> = {};
  if (!E.length) return out;
  const arr = claims.map((c) => {
    const amount = Math.max(0, Number(c.amount) || 0);
    return { id: c.id, amount, key: amount * (0.93 + 0.14 * rng()) };
  });
  arr.sort((a, b) => b.key - a.key);
  for (const c of arr) {
    let minCount = Infinity;
    for (const e of E) if (e.count < minCount) minCount = e.count;
    const cand = E.filter((e) => e.count === minCount);
    let minSum = Infinity;
    for (const e of cand) if (e.sum < minSum) minSum = e.sum;
    const near = cand.filter((e) => e.sum <= minSum + c.amount * 0.3);
    const pick = near[Math.floor(rng() * near.length)] ?? near[0]!;
    pick.count += 1;
    pick.sum += c.amount;
    out[c.id] = pick.uid;
  }
  return out;
}
