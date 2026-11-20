import { useEffect, useState } from "react";
import { supabase } from "@/integrations/external/client";
import type { Role, Status } from "@/lib/mutabee";

export const DOMAIN = "users.mutabee.app";
export const toEmail = (u: string) => `${String(u).trim().toLowerCase()}@${DOMAIN}`;

export type Profile = { uid: string; name: string; username: string; role: Role; active: boolean; projectIds: string[] };
export type Project = { id: string; name: string; columns: string[]; display_cols: string[]; statuses: Status[]; mapping: Record<string, string>; added_columns: string[] };
export type Claim = {
  project_id: string; id: string; data: Record<string, string>; amount: number; paid: number;
  assignee: string | null; status: string | null; note: string; follow_up_date: string; seq: number;
  approved_paid: number; settlement_amount: number | null; last_note: string; coded: boolean;
  batch_id: string | null; updated_at: string | null; updated_by: string | null; updated_by_name: string | null;
};
export type History = { id: string; at: string; by_name: string | null; type: string; changes: Record<string, [string, string]> };

export const errMsg = (e: any): string => {
  const m = e?.message || "";
  if (e?.code === "42501" || /permission|row-level security|denied/i.test(m)) return "ليس لديك صلاحية لهذا الإجراء";
  if (/weak|easy to guess|pwned/i.test(m)) return "كلمة المرور ضعيفة أو مسرّبة، اختر كلمة أقوى";
  return m || "حدث خطأ";
};

export async function fetchProfiles(): Promise<Profile[]> {
  const [{ data: ps, error }, { data: rs }] = await Promise.all([
    supabase.from("profiles").select("*"),
    supabase.from("user_roles").select("user_id, role"),
  ]);
  if (error) throw error;
  const roles = new Map((rs || []).map((r) => [r.user_id, r.role as Role]));
  return (ps || []).filter((p) => roles.has(p.id)).map((p) => ({
    uid: p.id, name: p.name, username: p.username, role: roles.get(p.id)!, active: p.active, projectIds: p.project_ids || [],
  }));
}

export async function fetchMe(uid: string): Promise<Profile | null> {
  const [{ data: p }, { data: r }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", uid).maybeSingle(),
  ]);
  if (!p || !r) return null;
  return { uid: p.id, name: p.name, username: p.username, role: r.role as Role, active: p.active, projectIds: p.project_ids || [] };
}

export async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase.from("projects").select("*");
  if (error) throw error;
  return (data || []).map((p) => ({
    id: p.id, name: p.name,
    columns: (p.columns as string[]) || [], display_cols: (p.display_cols as string[]) || [],
    statuses: (p.statuses as Status[]) || [], mapping: (p.mapping as Record<string, string>) || {}, added_columns: (p.added_columns as string[]) || [],
  })).sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar"));
}

export async function fetchClaims(pid: string, onlyAssignee?: string): Promise<Claim[]> {
  const out: Claim[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    let q = supabase.from("claims").select("*").eq("project_id", pid).order("seq").order("id").range(from, from + size - 1);
    if (onlyAssignee) q = q.eq("assignee", onlyAssignee);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...((data || []) as unknown as Claim[]));
    if (!data || data.length < size) break;
  }
  return out;
}

export const chunk = <T,>(arr: T[], n: number) => {
  const r: T[][] = [];
  for (let i = 0; i < arr.length; i += n) r.push(arr.slice(i, i + n));
  return r;
};

/** Calls a database function (RPC). The functions behind reports / paging / distribution live in drizzle/migrations/0001. */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await (supabase as any).rpc(fn, args);
  if (error) throw error;
  return data as T;
}

/** A claim row as returned by the paging functions: the stored columns plus values computed in the database. */
export type ClaimRow = Claim & { rem: number; closed: boolean; main_status: string; seen?: boolean };
export type ClaimsPage = { total: number; rows: ClaimRow[] };

/** One database call as a hook: ignores stale answers; `refresh` re-runs it without being sent to the server. */
export function useRpc<T>(fn: string, args: Record<string, unknown>, enabled = true, refresh = 0) {
  const key = fn + JSON.stringify(args) + "#" + refresh;
  const [st, setSt] = useState<{ key: string; data?: T; error?: string }>({ key: "" });
  useEffect(() => {
    if (!enabled) return;
    let off = false;
    rpc<T>(fn, args).then((d) => { if (!off) setSt({ key, data: d }); }, (e) => { if (!off) setSt({ key, error: errMsg(e) }); });
    return () => { off = true; };
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = st.key === key;
  return { data: cur ? st.data : undefined, error: cur ? st.error : undefined, loading: enabled && !cur };
}
