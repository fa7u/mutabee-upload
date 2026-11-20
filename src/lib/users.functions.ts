import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/external/auth";
import { canManageUser } from "@/lib/user-permissions";

type Role = "owner" | "exec" | "supervisor" | "employee";
const DOMAIN = "users.mutabee.app";
const toEmail = (u: string) => `${u.trim().toLowerCase()}@${DOMAIN}`;
const USER_RE = /^[A-Za-z0-9._-]{3,30}$/;

const authErrorMessage = (message: string | undefined) =>
  /weak|guess|pwned/i.test(message || "") ? "كلمة المرور ضعيفة أو مسرّبة، اختر كلمة أقوى"
    : message?.includes("already") ? "اسم المستخدم مستخدم مسبقًا" : message || "خطأ";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/external/client.server");
  return supabaseAdmin;
}

async function ownerExists() {
  const a = await admin();
  const { count, error } = await a.from("user_roles").select("id", { count: "exact", head: true }).eq("role", "owner");
  if (error || count === null) throw new Error("تعذّر التحقق من إعداد النظام. حاول مرة أخرى لاحقًا.");
  return count > 0;
}

export const needsSetup = createServerFn({ method: "GET" }).handler(async () => ({ needed: !(await ownerExists()) }));

export const setupOwner = createServerFn({ method: "POST" })
  .validator((d: { name: string; username: string; password: string }) => d)
  .handler(async ({ data }) => {
    text(data.name, 1, 100); text(data.username, 3, 30); text(data.password, 8, 200);
    if (await ownerExists()) throw new Error("الإعداد الأولي تم مسبقًا");
    if (!USER_RE.test(data.username)) throw new Error("اسم المستخدم غير صالح");
    if ((data.password || "").length < 8) throw new Error("كلمة المرور قصيرة (8 أحرف على الأقل)");
    const a = await admin();
    const { data: cu, error } = await a.auth.admin.createUser({ email: toEmail(data.username), password: data.password, email_confirm: true });
    if (error || !cu.user) throw new Error(authErrorMessage(error?.message));
    // Any failure below removes the auth user again (the profile cascades) so no half-created owner is left behind.
    const { error: e2 } = await a.from("profiles").insert({ id: cu.user.id, name: data.name.trim(), username: data.username.toLowerCase(), active: true, project_ids: [] });
    if (e2) { await a.auth.admin.deleteUser(cu.user.id); throw new Error(e2.message.includes("duplicate") ? "اسم المستخدم مستخدم مسبقًا" : "تعذّر إنشاء المستخدم"); }
    // The unique index "one_owner" makes this fail if another setup request won the race.
    const { error: e3 } = await a.from("user_roles").insert({ user_id: cu.user.id, role: "owner" });
    if (e3) { await a.auth.admin.deleteUser(cu.user.id); throw new Error(/one_owner|duplicate/.test(e3.message) ? "الإعداد الأولي تم مسبقًا" : "تعذّر إنشاء المستخدم"); }
    return { ok: true };
  });

async function me(ctx: { supabase: any; userId: string }) {
  const { data: p } = await ctx.supabase.from("profiles").select("*").eq("id", ctx.userId).maybeSingle();
  const { data: r } = await ctx.supabase.from("user_roles").select("role").eq("user_id", ctx.userId).maybeSingle();
  if (!p || !p.active || !r) throw new Error("ليس لديك صلاحية لهذا الإجراء");
  return { role: r.role as Role, projectIds: (p.project_ids || []) as string[], name: p.name as string };
}

async function target(uid: string) {
  const a = await admin();
  const { data: p } = await a.from("profiles").select("*").eq("id", uid).maybeSingle();
  const { data: r } = await a.from("user_roles").select("role").eq("user_id", uid).maybeSingle();
  if (!p || !r) throw new Error("المستخدم غير موجود");
  return { ...p, role: r.role as Role };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const badInput = () => { throw new Error("بيانات غير صحيحة"); };
const text = (v: unknown, min: number, max: number) => { if (typeof v !== "string" || v.trim().length < min || v.length > max) badInput(); };
const uuidList = (v: unknown) => { if (!Array.isArray(v) || v.length > 200 || !v.every((x) => typeof x === "string" && UUID_RE.test(x))) badInput(); };
const deny = () => { throw new Error("ليس لديك صلاحية لهذا الإجراء"); };
const subset = (a: string[], b: string[]) => a.every((x) => b.includes(x));

export const createAppUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { name: string; username: string; password: string; role: Role; projectIds: string[] }) => d)
  .handler(async ({ data, context }) => {
    text(data.name, 1, 100); text(data.username, 3, 30); text(data.password, 8, 200); uuidList(data.projectIds ?? []);
    const m = await me(context);
    const allowed: Record<Role, Role[]> = { owner: ["exec", "supervisor", "employee"], exec: ["supervisor", "employee"], supervisor: ["employee"], employee: [] };
    if (!allowed[m.role].includes(data.role)) deny();
    if (m.role === "supervisor" && !subset(data.projectIds, m.projectIds)) deny();
    if (!USER_RE.test(data.username)) throw new Error("اسم المستخدم غير صالح");
    if ((data.password || "").length < 8) throw new Error("كلمة المرور ضعيفة (8 أحرف على الأقل)");
    const projectIds = ["owner", "exec"].includes(data.role) ? [] : data.projectIds;
    const a = await admin();
    const { data: cu, error } = await a.auth.admin.createUser({ email: toEmail(data.username), password: data.password, email_confirm: true });
    if (error || !cu.user) throw new Error(authErrorMessage(error?.message));
    const { error: e2 } = await a.from("profiles").insert({ id: cu.user.id, name: data.name.trim(), username: data.username.toLowerCase(), active: true, project_ids: projectIds, created_by: context.userId });
    if (e2) { await a.auth.admin.deleteUser(cu.user.id); throw new Error(e2.message.includes("duplicate") ? "اسم المستخدم مستخدم مسبقًا" : "تعذّر إنشاء المستخدم"); }
    const { error: e3 } = await a.from("user_roles").insert({ user_id: cu.user.id, role: data.role });
    if (e3) { await a.auth.admin.deleteUser(cu.user.id); throw new Error("تعذّر إنشاء المستخدم"); }
    return { ok: true };
  });

export const updateAppUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { uid: string; name: string; active: boolean; projectIds?: string[]; role?: Role }) => d)
  .handler(async ({ data, context }) => {
    text(data.uid, 36, 36); if (!UUID_RE.test(data.uid)) badInput(); text(data.name, 1, 100);
    if (typeof data.active !== "boolean") badInput();
    if (data.projectIds !== undefined) uuidList(data.projectIds);
    if (data.role !== undefined && !["exec", "supervisor", "employee", "owner"].includes(data.role)) badInput();
    const m = await me(context);
    if (data.uid === context.userId) deny();
    const t = await target(data.uid);
    const patch: Record<string, unknown> = { name: data.name.trim(), active: data.active };
    let newRole: Role = t.role;
    if (m.role === "owner") {
      if (data.role && data.role !== "owner") newRole = data.role;
      if (data.projectIds) patch["project_ids"] = data.projectIds;
    } else if (m.role === "exec") {
      if (!["supervisor", "employee"].includes(t.role)) deny();
      if (data.projectIds) patch["project_ids"] = data.projectIds;
    } else if (m.role === "supervisor") {
      if (t.role !== "employee" || !((t["project_ids"] as string[]) || []).some((p: string) => m.projectIds.includes(p))) deny();
      if (data.projectIds) {
        const keep = ((t["project_ids"] as string[]) || []).filter((p: string) => !m.projectIds.includes(p));
        patch["project_ids"] = [...keep, ...data.projectIds.filter((p) => m.projectIds.includes(p))];
      }
    } else deny();
    if (["owner", "exec"].includes(newRole)) patch["project_ids"] = [];
    const a = await admin();
    const { error } = await a.from("profiles").update(patch as any).eq("id", data.uid);
    if (error) throw new Error("تعذّر حفظ التعديل");
    if (newRole !== t.role) await a.from("user_roles").update({ role: newRole }).eq("user_id", data.uid);
    return { ok: true };
  });

export const deleteAppUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { uid: string }) => d)
  .handler(async ({ data, context }) => {
    text(data.uid, 36, 36); if (!UUID_RE.test(data.uid)) badInput();
    const m = await me(context);
    if (data.uid === context.userId) deny();
    const t = await target(data.uid);
    if (!canManageUser(m, t)) deny();
    const a = await admin();
    const { data: rel } = await a.from("claims").update({ assignee: null, assigned_at: new Date().toISOString(), assigned_by: context.userId }).eq("assignee", data.uid).select("id");
    const { error } = await a.auth.admin.deleteUser(data.uid);
    if (error) throw new Error("تعذّر حذف المستخدم");
    return { released: rel?.length || 0 };
  });

/** A manager sets a new password for someone below them (the new password is shown to the manager on purpose). */
export const resetAppUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { uid: string; password: string }) => d)
  .handler(async ({ data, context }) => {
    text(data.uid, 36, 36); if (!UUID_RE.test(data.uid)) badInput(); text(data.password, 8, 200);
    const m = await me(context);
    if (data.uid === context.userId) deny();
    const t = await target(data.uid);
    if (!canManageUser(m, t)) deny();
    if ((data.password || "").length < 8) throw new Error("كلمة المرور ضعيفة (8 أحرف على الأقل)");
    const a = await admin();
    const { error } = await a.auth.admin.updateUserById(data.uid, { password: data.password });
    if (error) throw new Error(authErrorMessage(error.message));
    return { ok: true };
  });
