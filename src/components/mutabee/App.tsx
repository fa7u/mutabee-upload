import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as XLSX from "xlsx";
import * as XLSXStyle from "xlsx-js-style";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/external/client";
import * as L from "@/lib/mutabee";
import type { Role, Status } from "@/lib/mutabee";
import { createAppUser, deleteAppUser, needsSetup, resetAppUserPassword, setupOwner, updateAppUser } from "@/lib/users.functions";
import { chunk, errMsg, fetchMe, fetchProfiles, fetchProjects, rpc, toEmail, useRpc, type Claim, type ClaimRow, type ClaimsPage, type History, type Profile, type Project } from "./data";

import { approvedTotals, canReviewPayment, nextMonthDate, paymentKind, withPaymentStatuses } from "@/lib/payments";
import { PaymentFields, PaymentReview, type PaymentInput } from "./Payments";
import { Reports } from "./Reports";
import { Button } from "@/components/ui/button";

const APP_NAME = "مُتابِع";
import logoAsset from "@/assets/mutabee-logo-eye.png.asset.json";
import { LayoutList, BarChart3, BellRing, Star, BadgeCheck, Upload, Users, Settings2, FolderKanban, KeyRound, LogOut, Tag, TrendingUp } from "lucide-react";
const fmtTs = (t: string | null) => (t ? new Date(t).toLocaleString("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" }) : "—");
const nowIso = () => new Date().toISOString();
const FIELD_LABEL: Record<string, string> = { status: "الحالة", note: "الملاحظة", followUpDate: "موعد المتابعة", assignee: "الموظف" };
const ROLES_CAN_ADD: Record<Role, Role[]> = { owner: ["exec", "supervisor", "employee"], exec: ["supervisor", "employee"], supervisor: ["employee"], employee: [] };

/* ============================== toast ============================== */
let toastFn: (m: string, bad?: boolean) => void = () => {};
const toast = (m: string, bad?: boolean) => toastFn(m, bad);

function copyCell(v: unknown, toastFn2: (m: string, bad?: boolean) => void) {
  const t = String(v ?? "").trim();
  if (!t) return;
  const done = () => toastFn2("تم النسخ: " + (t.length > 40 ? t.slice(0, 40) + "…" : t));
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(t).then(done, () => toastFn2("تعذّر النسخ", true));
  } else {
    const ta = document.createElement("textarea");
    ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch { toastFn2("تعذّر النسخ", true); }
    document.body.removeChild(ta);
  }
}
let copyTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleCopy(v: unknown, t: typeof toast) { clearTimeout(copyTimer); copyTimer = setTimeout(() => copyCell(v, t), 350); }
/* Double-click / double-tap anywhere on a row (not on its inputs) opens the claim. */
let lastTap = { id: "", t: 0 };
function rowTap(e: { target: EventTarget | null }, id: string, open: () => void) {
  const el = e.target as HTMLElement | null;
  if (el?.closest("input,select,button,textarea,a,label")) return;
  const now = Date.now();
  if (lastTap.id === id && now - lastTap.t < 450) {
    clearTimeout(copyTimer);
    lastTap = { id: "", t: 0 };
    window.getSelection()?.removeAllRanges();
    open();
    return;
  }
  lastTap = { id, t: now };
}

/* Reminder badge: remember opened reminders per user across refreshes (keyed by claim + due date). */

function Toast() {
  const [t, setT] = useState<{ m: string; bad?: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    toastFn = (m, bad) => { setT({ m, bad: !!bad }); clearTimeout(timer.current); timer.current = setTimeout(() => setT(null), bad ? 5000 : 2600); };
  }, []);
  return <div className="toastbox">{t && <span className={t.bad ? "bad" : ""}>{t.m}</span>}</div>;
}

function Modal({ children, wide, onClose }: { children: ReactNode; wide?: boolean; onClose: () => void }) {
  return (
    <div className="ov" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`dlg ${wide ? "wide" : ""}`}>{children}</div>
    </div>
  );
}

/* ============================== root ============================== */
export default function MutabeeApp() {
  const [phase, setPhase] = useState<"loading" | "login" | "setup" | "app">("loading");
  const [me, setMe] = useState<Profile | null>(null);
  const [loginError, setLoginError] = useState("");
  const settingUp = useRef(false);

  const load = useCallback(async (uid: string | null) => {
    if (!uid) { setMe(null); setPhase("login"); return; }
    try {
      const p = await fetchMe(uid);
      if (!p || !p.active) {
        setLoginError("هذا الحساب غير مفعّل أو غير موجود. تواصل مع المشرف.");
        await supabase.auth.signOut();
        return;
      }
      setMe(p); setPhase("app");
    } catch (e) { setLoginError(errMsg(e)); await supabase.auth.signOut(); }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session?.user.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((ev, s) => {
      if (settingUp.current) return;
      if (ev === "SIGNED_IN" || ev === "SIGNED_OUT") load(s?.user.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  return (
    <div className="mt" dir="rtl" lang="ar">
      {phase === "loading" && <p className="center muted" style={{ padding: 40 }}>جاري التحميل…</p>}
      {phase === "login" && <Login error={loginError} clearError={() => setLoginError("")} onSetup={() => setPhase("setup")} />}
      {phase === "setup" && <Setup settingUp={settingUp} onDone={load} onBack={() => setPhase("login")} />}
      {phase === "app" && me && <Main initialMe={me} onKicked={(m) => { setLoginError(m); supabase.auth.signOut(); }} />}
      <Toast />
    </div>
  );
}

function Login({ error, clearError, onSetup }: { error: string; clearError: () => void; onSetup: () => void }) {
  const [err, setErr] = useState(error);
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  const check = useServerFn(needsSetup);
  useEffect(() => { clearError(); check().then((r) => setSetup(r.needed)).catch(() => { setSetup(false); setErr("تعذّر التحقق من إعداد النظام. حاول مرة أخرى لاحقًا."); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (error) setErr(error); }, [error]);
  return (
    <div className="auth card">
      <img src={logoAsset.url} alt={APP_NAME} className="auth-logo" />
      <p className="center muted small" style={{ marginTop: -6, marginBottom: 14 }}>متابعة المطالبات</p>
      <form onSubmit={async (e) => {
        e.preventDefault(); const fd = new FormData(e.currentTarget); setBusy(true); setErr("");
        const { error } = await supabase.auth.signInWithPassword({ email: toEmail(String(fd.get("u"))), password: String(fd.get("p")) });
        setBusy(false);
        if (error) setErr("اسم المستخدم أو كلمة المرور غير صحيحة");
      }}>
        <input name="u" placeholder="اسم المستخدم" autoComplete="username" required dir="ltr" />
        <input name="p" type="password" placeholder="كلمة المرور" autoComplete="current-password" required />
        <div className="err">{err}</div>
        <button className="pri" disabled={busy}>دخول</button>
      </form>
      {setup && <p className="center small"><a href="#" onClick={(e) => { e.preventDefault(); onSetup(); }}>إعداد أولي: إنشاء حساب مالك النظام</a></p>}
    </div>
  );
}

function Setup({ settingUp, onDone, onBack }: { settingUp: React.MutableRefObject<boolean>; onDone: (uid: string | null) => void; onBack: () => void }) {
  const [err, setErr] = useState("");
  const run = useServerFn(setupOwner);
  return (
    <div className="auth card">
      <h2 className="center">إنشاء مالك النظام</h2>
      <p className="muted small">يظهر هذا مرة واحدة فقط، وبعدها يُقفل.</p>
      <form onSubmit={async (e) => {
        e.preventDefault(); const fd = new FormData(e.currentTarget);
        const name = String(fd.get("n")).trim(), username = String(fd.get("u")).trim(), password = String(fd.get("p"));
        try {
          await run({ data: { name, username, password } });
          settingUp.current = true;
          const { data, error } = await supabase.auth.signInWithPassword({ email: toEmail(username), password });
          settingUp.current = false;
          if (error) throw error;
          onDone(data.user?.id ?? null);
        } catch (er) { settingUp.current = false; setErr(errMsg(er)); }
      }}>
        <input name="n" placeholder="الاسم" required />
        <input name="u" placeholder="اسم المستخدم (إنجليزي، أرقام)" dir="ltr" required pattern="[A-Za-z0-9._\-]{3,30}" />
        <input name="p" type="password" placeholder="كلمة المرور (8 أحرف على الأقل)" minLength={8} required />
        <div className="err">{err}</div>
        <button className="pri">إنشاء</button>
        <button type="button" onClick={onBack}>رجوع</button>
      </form>
    </div>
  );
}

/* ============================== main app ============================== */
type View = "coded" | "favorites" | "tracker" | "dashboard" | "reminders" | "data" | "team" | "settings" | "projects" | "payments" | "reports";
type Filters = { q: string; status: string; asg: string; fu: string; page: number };
const emptyF: Filters = { q: "", status: "", asg: "", fu: "", page: 0 };

function Main({ initialMe, onKicked }: { initialMe: Profile; onKicked: (m: string) => void }) {
  const [me, setMe] = useState(initialMe);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [pid, setPid] = useState<string | null>(() => (typeof window !== "undefined" ? localStorage.getItem("pid") : null));
  /* Claims are no longer loaded wholesale: each screen asks the database for what it shows (paging, search, filters, totals).
     Rows any screen has loaded are remembered here so a claim can be opened by id. */
  const store = useRef(new Map<string, ClaimRow>());
  const register = useCallback((rows: ClaimRow[]) => { for (const r of rows) store.current.set(r.id, r); }, []);
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const [pageData, setPageData] = useState<ClaimsPage>({ total: 0, rows: [] });
  const [pageLoading, setPageLoading] = useState(false);
  const [view, setView] = useState<View>("tracker");
  const [f, setF] = useState<Filters>(emptyF);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<ReactNode>(null);

  const isMgr = ["owner", "exec", "supervisor"].includes(me.role);
  const isTop = ["owner", "exec"].includes(me.role);
  const project = projects.find((p) => p.id === pid) || null;

  /* ---- subscriptions ---- */
  const reloadMe = useCallback(async () => {
    const p = await fetchMe(me.uid);
    if (!p || !p.active) return onKicked("تم تعطيل حسابك.");
    setMe(p);
  }, [me.uid, onKicked]);
  const reloadProjects = useCallback(() => fetchProjects().then(setProjects).catch((e) => toast(errMsg(e), true)), []);
  const reloadUsers = useCallback(() => { if (isMgr) fetchProfiles().then(setUsers).catch((e) => toast(errMsg(e), true)); }, [isMgr]);

  useEffect(() => { reloadProjects(); reloadUsers(); }, [reloadProjects, reloadUsers, me.role, me.projectIds.join(",")]);
  useEffect(() => {
    const ch = supabase.channel("meta-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, (pl: any) => {
        const id = pl.new?.id || pl.old?.id;
        if (id === me.uid) reloadMe();
        reloadUsers();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, () => reloadProjects())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [me.uid, reloadMe, reloadUsers, reloadProjects]);

  useEffect(() => {
    if (!projects.length) { if (pid !== null) setPid(null); return; }
    if (!projects.find((p) => p.id === pid)) setPid(projects[0]!.id);
  }, [projects, pid]);
  useEffect(() => { if (pid) localStorage.setItem("pid", pid); setSel(new Set()); }, [pid]);

  const reloadClaims = useCallback(async () => { bump(); }, [bump]);

  /* Any change to this project's claims (mine or someone else's) refreshes what is on screen, debounced. */
  useEffect(() => {
    store.current.clear();
    if (!pid) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const ch = supabase.channel("claims-" + pid + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "claims", filter: `project_id=eq.${pid}` }, () => { clearTimeout(t); t = setTimeout(bump, 700); })
      .subscribe();
    const onFocus = () => bump();
    window.addEventListener("focus", onFocus);
    return () => { clearTimeout(t); supabase.removeChannel(ch); window.removeEventListener("focus", onFocus); };
  }, [pid, bump]);

  /* The claims list: search / filters / paging all happen in the database (claims_page). */
  const PER = 50;
  const [qDeb, setQDeb] = useState(f.q);
  useEffect(() => { const t = setTimeout(() => setQDeb(f.q), 300); return () => clearTimeout(t); }, [f.q]);
  useEffect(() => {
    if (!pid || view !== "tracker") return;
    let off = false; setPageLoading(true);
    rpc<ClaimsPage>("claims_page", { p_project: pid, p_q: qDeb, p_status: f.status, p_asg: f.asg, p_fu: f.fu, p_limit: PER, p_offset: f.page * PER })
      .then((d) => {
        if (off) return;
        if (d.total > 0 && d.rows.length === 0 && f.page > 0) { setF({ ...f, page: Math.max(0, Math.ceil(d.total / PER) - 1) }); return; }
        register(d.rows); setPageData(d);
      }, (e) => { if (!off) toast(errMsg(e), true); })
      .finally(() => { if (!off) setPageLoading(false); });
    return () => { off = true; };
  }, [pid, view, qDeb, f.status, f.asg, f.fu, f.page, tick, register]); // eslint-disable-line react-hooks/exhaustive-deps


  /* ---- project helpers ---- */
  const BUILTIN_SUBS = ["s_partial", "s_scheduled", "s_discount"];
  const stAll: Status[] = withPaymentStatuses(L.withDefaultStatuses(project?.statuses?.length ? project.statuses : L.DEFAULT_STATUSES))
    .map((s) => (BUILTIN_SUBS.includes(s.id) ? { ...s, parent: "s_paid" } : s));
  const stList: Status[] = stAll.filter((s) => !s.parent);
  const stOf = (c: Claim): Status => {
    const real = stAll.find((s) => s.id === c.status) || stList[0]!;
    if (!real.parent) return real;
    const base = stList.find((s) => s.id === real.parent) || real;
    return { ...base, name: `${base.name} · ${real.name}`, color: real.color, closed: real.closed };
  };
  /* remaining / closed come from the database (single source of truth); the local rule is only a fallback for rows without them. */
  const calc = (c: Claim) => {
    const r = c as Partial<ClaimRow>;
    return typeof r.rem === "number" && typeof r.closed === "boolean"
      ? { amt: Math.max(0, Number(c.amount) || 0), paid: Math.max(0, Number(c.approved_paid) || 0), rem: r.rem, closed: r.closed }
      : approvedTotals(c, stOf(c));
  };
  const displayCols = () => {
    const p = project; if (!p) return [];
    return p.display_cols?.length ? p.display_cols.filter((c) => (p.columns || []).includes(c)) : (p.columns || []).slice(0, 4);
  };
  const userName = (uid: string | null) => (uid ? (users.find((u) => u.uid === uid)?.name || (uid === me.uid ? me.name : "موظف محذوف")) : "غير موزّعة");
  const claimTitle = (c: Claim) => displayCols().slice(0, 3).map((k) => c.data?.[k]).filter(Boolean).join(" · ") || c.id.slice(0, 8);
  const employees = users.filter((u) => u.role === "employee" && u.active && pid && u.projectIds.includes(pid));
  const today = L.todayRiyadh();
  /* Reminder badge: due follow-ups not yet opened (by the assigned employee, or by me). Counted in the database. */
  const [dueCount, setDueCount] = useState(0);
  const reloadDue = useCallback(async () => {
    if (!pid) { setDueCount(0); return; }
    try { setDueCount(Number(await rpc<number>("due_unseen_count", { p_project: pid }))); } catch { /* badge only */ }
  }, [pid]);
  useEffect(() => { void reloadDue(); }, [reloadDue, tick]);


  /* Pending coding requests badge (managers). */
  const [codingPending, setCodingPending] = useState(0);
  useEffect(() => {
    if (!pid || !isMgr) { setCodingPending(0); return; }
    void supabase.from("coding_requests").select("id", { count: "exact", head: true }).eq("project_id", pid).eq("state", "pending")
      .then(({ count }) => setCodingPending(count || 0));
  }, [pid, isMgr, tick]);

  /* Pending payment requests badge (managers): count awaiting supervisor approval. */
  const [pendingPay, setPendingPay] = useState(0);
  const reloadPending = useCallback(async () => {
    if (!pid || !isMgr) { setPendingPay(0); return; }
    const { count } = await supabase.from("claim_payments").select("id", { count: "exact", head: true }).eq("project_id", pid).eq("state", "pending");
    setPendingPay(count || 0);
  }, [pid, isMgr]);
  useEffect(() => {
    void reloadPending();
    const onFocus = () => void reloadPending();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reloadPending]);

  /* ---- favorites: employees star claims; managers see everyone's stars ---- */
  const [favs, setFavs] = useState<{ user_id: string; claim_id: string }[]>([]);
  const reloadFavs = useCallback(async () => {
    if (!pid) { setFavs([]); return; }
    const { data } = await supabase.from("claim_favorites").select("user_id, claim_id").eq("project_id", pid);
    setFavs(data || []);
  }, [pid]);
  useEffect(() => { void reloadFavs(); }, [reloadFavs, tick]);
  const favSet = new Set(favs.filter((x) => x.user_id === me.uid).map((x) => x.claim_id));
  async function toggleFav(id: string) {
    if (!pid) return;
    const on = favSet.has(id);
    setFavs((p) => on ? p.filter((x) => !(x.user_id === me.uid && x.claim_id === id)) : [...p, { user_id: me.uid, claim_id: id }]);
    const { error } = on
      ? await supabase.from("claim_favorites").delete().eq("user_id", me.uid).eq("project_id", pid).eq("claim_id", id)
      : await supabase.from("claim_favorites").insert({ user_id: me.uid, project_id: pid, claim_id: id });
    if (error) { toast(errMsg(error), true); void reloadFavs(); } else toast(on ? "أُزيلت من المفضلة" : "أُضيفت إلى المفضلة");
  }

  /* ---- writes ---- */
  /** Status / note / follow-up / data edits go through save_claim_update: the database computes the diff and writes the history. */
  async function saveClaim(id: string, patch: { status?: string; note?: string; followUpDate?: string }, data?: Record<string, string>) {
    const c = store.current.get(id); if (!c) return;
    if (patch.status && paymentKind(stAll.find(s => s.id === patch.status))) { openClaim(id, patch.status); return; }
    const changedData: Record<string, string> = {};
    for (const k of Object.keys(data || {})) {
      const o = c.data?.[k] || "", n = (data![k] || "").trim();
      if (o !== n) changedData[k] = n;
    }
    const { error } = await supabase.rpc("save_claim_update", {
      p_project: c.project_id, p_claim: id,
      ...(patch.status !== undefined ? { p_status: patch.status } : {}),
      ...(patch.note !== undefined ? { p_note: patch.note } : {}),
      ...(patch.followUpDate !== undefined ? { p_follow_up: patch.followUpDate } : {}),
      ...(Object.keys(changedData).length ? { p_data: changedData } : {}),
    });
    if (error) { toast(errMsg(error), true); return false; }
    await reloadClaims();
    return true;
  }

  async function transfer(ids: string[], toUid: string | null) {
    if (!pid || !ids.length) return;
    try {
      let done = 0;
      for (const part of chunk(ids, 20000)) {
        const { data, error } = await supabase.rpc("transfer_claims", { p_project: pid, p_ids: part, p_to: toUid as string });
        if (error) throw error;
        done += Number(data || 0);
      }
      toast(done ? `تم نقل ${done} مطالبة` : "لا تغيير: المطالبات عند هذا الموظف مسبقًا");
      bump();
    } catch (e) { toast(errMsg(e), true); }
  }


  async function updateProject(patch: Record<string, unknown>) {
    if (!pid) return false;
    const { error } = await supabase.from("projects").update(patch as any).eq("id", pid);
    if (error) { toast(errMsg(error), true); return false; }
    reloadProjects(); return true;
  }

  /* ---- export ---- */
  function saveXlsx(rows: Record<string, unknown>[], name: string) {
    const ws = XLSX.utils.json_to_sheet(rows), wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "بيانات");
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.writeFile(wb, name + ".xlsx");
  }
  function claimRows(list: Claim[]) {
    const cols = project?.columns || [];
    return list.map((c) => {
      const k = calc(c), r: Record<string, unknown> = {};
      cols.forEach((n) => (r[n] = c.data?.[n] ?? ""));
      Object.assign(r, { "المبلغ": k.amt, "المسدّد": k.paid, "المتبقي": k.rem, "الموظف": userName(c.assignee), "الحالة": stOf(c).name, "مكود": c.coded ? "نعم" : "", "موعد المتابعة": c.follow_up_date || "", "ملاحظة": c.last_note || "", "آخر تعديل": fmtTs(c.updated_at) });
      return r;
    });
  }

  /** Professional colored export: uniform teal header, data rows tinted with each claim's status color. */
  function saveStyledClaimsXlsx(list: Claim[], name: string) {
    if (!project) return;
    if (!list.length) { toast("لا توجد مطالبات للتصدير", true); return; }
    const rows = claimRows(list);
    const headers = Object.keys(rows[0]!);
    const ws = XLSXStyle.utils.json_to_sheet(rows);
    const range = XLSXStyle.utils.decode_range(ws["!ref"] || "A1");
    const tint = (hex: string) => {
      const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "64748B";
      return [0, 2, 4].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * 0.16 + 255 * 0.84).toString(16).padStart(2, "0").toUpperCase()).join("");
    };
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[XLSXStyle.utils.encode_cell({ r: 0, c: C })];
      if (cell) cell.s = { fill: { patternType: "solid", fgColor: { rgb: "0F766E" } }, font: { bold: true, color: { rgb: "FFFFFF" }, sz: 12 }, alignment: { horizontal: "center", vertical: "center" }, border: { bottom: { style: "thin", color: { rgb: "0B5450" } } } };
    }
    for (let R = 1; R <= range.e.r; R++) {
      const fill = { patternType: "solid", fgColor: { rgb: tint(stOf(list[R - 1]!).color) } };
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addr = XLSXStyle.utils.encode_cell({ r: R, c: C });
        const cell = ws[addr] || (ws[addr] = { t: "s", v: "" });
        cell.s = { fill, alignment: { vertical: "center" } };
      }
    }
    ws["!cols"] = headers.map((h) => {
      let w = String(h).length;
      for (const r of rows) { const v = String(r[h] ?? ""); if (v.length > w) w = v.length; }
      return { wch: Math.min(45, Math.max(11, w + 3)) };
    });
    ws["!rows"] = [{ hpt: 22 }];
    ws["!autofilter"] = { ref: ws["!ref"]! };
    const wb = XLSXStyle.utils.book_new();
    XLSXStyle.utils.book_append_sheet(wb, ws, "مطالبات");
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSXStyle.writeFile(wb, name + ".xlsx");
  }

  /** Reads every page of a claims query (export of "all results"). */
  async function fetchAllRows(args: Record<string, unknown>, max = 50000): Promise<Claim[]> {
    const out: Claim[] = [];
    for (let off = 0; off < max; off += 1000) {
      const d = await rpc<ClaimsPage>("claims_page", { p_project: pid, ...args, p_limit: 1000, p_offset: off });
      out.push(...d.rows);
      if (d.rows.length < 1000) break;
    }
    return out;
  }
  async function exportClaims() {
    if (!project) return;
    try {
      toast("جاري تجهيز الملف…");
      const rows = await fetchAllRows({ p_q: f.q, p_status: f.status, p_asg: f.asg, p_fu: f.fu });
      saveStyledClaimsXlsx(rows, "مطالبات-" + project.name);
    } catch (e) { toast(errMsg(e), true); }
  }


  /* ---- claim modal ---- */
  function openClaim(id: string, initialStatus?: string) {
    const c = store.current.get(id); if (!c) return;
    if (c.follow_up_date && c.follow_up_date <= today) {
      void supabase.from("reminder_seen")
        .upsert({ project_id: c.project_id, claim_id: c.id, due_date: c.follow_up_date }, { onConflict: "user_id,project_id,claim_id,due_date", ignoreDuplicates: true })
        .then(() => reloadDue(), () => undefined);
    }

    setModal(<ClaimModal c={c} title={claimTitle(c)} st={stOf(c)} stList={stList} stAll={stAll} k={calc(c)} assigneeName={userName(c.assignee)} initialStatus={initialStatus}
      canReview={canReviewPayment(me.role, me.projectIds, c.project_id)} meId={me.uid} canRequestCoding={me.role === "employee"} onReviewed={() => { void reloadClaims(); setModal(null); }}
      columns={project?.columns || []} canEditData canEditCol={(col) => isMgr || (project?.added_columns || []).includes(col)} canDeleteHist={isMgr} fav={favSet.has(id)} onFav={() => void toggleFav(id)}
      onClose={() => setModal(null)} onSaveData={async () => {}} onSave={async (p, payment, d) => {
        if (payment) {
          const { error } = await supabase.rpc("submit_claim_payment", { p_project: c.project_id, p_claim: id, p_status: p.status, p_kind: payment.kind, p_amount: payment.amount, p_discount: payment.discount ?? 0, p_date: payment.date });
          if (error) { toast(errMsg(error), true); return false; }
          const ok = await saveClaim(id, { note: p.note, ...(payment.kind === "scheduled" ? {} : { followUpDate: p.followUpDate }) }, d);
          if (ok === false) return false;
          toast("تم إرسال السداد لموافقة مشرف المشروع");
        } else {
          const ok = await saveClaim(id, p, d);
          if (ok === false) return false;
          toast("تم الحفظ");
        }
        await reloadClaims(); setModal(null);
        return true;
      }} />);
  }

  async function openClaimById(projectId: string, id: string) {
    try {
      if (!store.current.get(id)) {
        const d = await rpc<ClaimsPage>("claims_page", { p_project: projectId, p_ids: [id], p_limit: 1 });
        register(d.rows);
      }
      if (!store.current.get(id)) { toast("المطالبة غير موجودة أو ليست ضمن صلاحياتك", true); return; }
      openClaim(id);
    } catch (e) { toast(errMsg(e), true); }
  }

  /* ---- tabs ---- */
  const I = (C: typeof Star) => <C size={18} strokeWidth={2} />;
  const tabs: [View, ReactNode][] = [["tracker", <>{I(LayoutList)}<span>المطالبات</span></>], ["favorites", <>{I(Star)}<span>المفضلة</span>{favSet.size ? <span className="cnt">{favSet.size}</span> : null}</>], ["dashboard", <>{I(BarChart3)}<span>لوحة المتابعة</span></>], ["reports", <>{I(TrendingUp)}<span>{isMgr ? "التقارير" : "تقريري"}</span></>], ["reminders", <>{I(BellRing)}<span>التذكيرات</span>{dueCount ? <span className="badge">{dueCount}</span> : null}</>], ["coded", <>{I(Tag)}<span>المكودة</span>{isMgr && codingPending ? <span className="badge">{codingPending}</span> : null}</>]];
  if (isMgr) tabs.push(["payments", <>{I(BadgeCheck)}<span>اعتماد السدادات</span>{pendingPay ? <span className="badge">{pendingPay}</span> : null}</>], ["data", <>{I(Upload)}<span>الرفع والتوزيع</span></>], ["team", <>{I(Users)}<span>الفريق</span></>], ["settings", <>{I(Settings2)}<span>إعدادات المشروع</span></>]);
  if (isTop) tabs.push(["projects", <>{I(FolderKanban)}<span>المشاريع</span></>]);
  const curView = tabs.find((t) => t[0] === view) ? view : "tracker";
  const needsProject = curView !== "projects" && curView !== "team" && curView !== "reports";

  const ctx = { me, isMgr, isTop, project, projects, users, tick, register, reloadClaims, employees, stList, stAll, stOf, calc, displayCols, userName, claimTitle, pid, setModal, toast, reloadUsers, reloadProjects, updateProject, transfer, today, openClaim, favSet, toggleFav: (id: string) => void toggleFav(id) };

  let body: ReactNode;
  if (!project && needsProject) {
    body = <div className="card center muted">{isTop ? "لا توجد مشاريع بعد. أنشئ مشروعًا من تبويب «المشاريع»." : "لست مرتبطًا بأي مشروع. تواصل مع المشرف."}</div>;
  } else if (curView === "tracker") {
    body = <Tracker ctx={ctx} f={f} setF={setF} pageData={pageData} per={PER} loading={pageLoading} sel={sel} setSel={setSel} saveClaim={saveClaim} openClaim={openClaim} exportClaims={exportClaims} />;
  } else if (curView === "favorites") {
    body = <Favorites ctx={ctx} favs={favs} />;
  } else if (curView === "dashboard") {
    body = <Dashboard ctx={ctx} saveXlsx={saveXlsx} fetchAll={fetchAllRows} onExportClaims={(list, name) => saveStyledClaimsXlsx(list, name)} />;
  } else if (curView === "reminders") {
    body = <Reminders ctx={ctx} openClaim={openClaim} />;
  } else if (curView === "coded") {
    body = <CodedView ctx={ctx} onChanged={reloadClaims} />;
  } else if (curView === "reports") {
    body = <Reports me={me} isMgr={isMgr} isTop={isTop} projects={projects} users={users} pid={pid} setPid={(id) => { setPid(id); setF(emptyF); setView("tracker"); }} openClaimById={(p, id) => void openClaimById(p, id)} toast={toast} />;
  } else if (curView === "payments") {
    body = pid && <PaymentsView key={pid} ctx={ctx} projectId={pid} canReview={canReviewPayment(me.role, me.projectIds, pid)} onReviewed={() => { void reloadPending(); void reloadClaims(); }} />;
  } else if (curView === "data") {
    body = <DataView key={pid || ""} ctx={ctx} reloadClaims={reloadClaims} />;
  } else if (curView === "team") {
    body = <Team ctx={ctx} />;
  } else if (curView === "settings") {
    body = <Settings key={pid || ""} ctx={ctx} />;
  } else {
    body = <Projects ctx={ctx} />;
  }

  return (
    <>
      <div className="shell">
        <nav className="side">
          <div className="side-brand">
            <img src={logoAsset.url} alt={APP_NAME} />
          </div>
          {projects.length > 0 && (
            <select className="side-proj" value={pid || ""} onChange={(e) => { setPid(e.target.value); setF(emptyF); }}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <div className="side-items">
            {tabs.map(([k, t]) => <button key={k} className={curView === k ? "on" : ""} onClick={() => setView(k)}>{t}</button>)}
          </div>
          <div className="side-foot">
            <div className="side-user"><b>{me.name}</b><small>{L.ROLE_LABEL[me.role]}</small></div>
            <button onClick={() => setModal(<PassModal me={me} onClose={() => setModal(null)} />)}><KeyRound size={16} /><span>كلمة المرور</span></button>
            <button onClick={() => supabase.auth.signOut()}><LogOut size={16} /><span>تسجيل الخروج</span></button>
          </div>
        </nav>
        <main>{body}</main>
      </div>
      {modal && <Modal wide onClose={() => setModal(null)}>{modal}</Modal>}
    </>
  );
}

type Ctx = {
  me: Profile; isMgr: boolean; isTop: boolean; project: Project | null; projects: Project[]; users: Profile[]; tick: number; register: (rows: ClaimRow[]) => void; reloadClaims: () => Promise<void>; employees: Profile[];
  stList: Status[]; stAll: Status[]; stOf: (c: Claim) => Status; calc: (c: Claim) => { amt: number; paid: number; rem: number; closed: boolean };
  displayCols: () => string[]; userName: (u: string | null) => string; claimTitle: (c: Claim) => string; pid: string | null;
  setModal: (n: ReactNode) => void; toast: typeof toast; reloadUsers: () => void; reloadProjects: () => void;
  updateProject: (p: Record<string, unknown>) => Promise<boolean>; transfer: (ids: string[], to: string | null) => Promise<void>; today: string;
  openClaim: (id: string) => void; favSet: Set<string>; toggleFav: (id: string) => void;
};

/* ---------- tracker ---------- */
function Tracker({ ctx, f, setF, pageData, per, loading, sel, setSel, saveClaim, openClaim, exportClaims }: {
  ctx: Ctx; f: Filters; setF: (f: Filters) => void; pageData: ClaimsPage; per: number; loading: boolean; sel: Set<string>; setSel: (s: Set<string>) => void;
  saveClaim: (id: string, p: { status?: string; note?: string; followUpDate?: string }) => void; openClaim: (id: string) => void; exportClaims: () => void;
}) {
  const { isMgr, employees: emps, stList, stOf, calc, displayCols, userName } = ctx;
  const [bulkTo, setBulkTo] = useState("");
  const pages = Math.max(1, Math.ceil(pageData.total / per));
  const page = Math.min(f.page, pages - 1);
  const rows = pageData.rows;
  const cols = displayCols();
  const upd = (p: Partial<Filters>) => setF({ ...f, ...p, page: "page" in p ? p.page! : 0 });
  const toggle = (id: string, on: boolean) => { const s = new Set(sel); on ? s.add(id) : s.delete(id); setSel(s); };
  return (
    <>
      <div className="card">
        <div className="row">
          <input type="search" placeholder="بحث…" value={f.q} onChange={(e) => upd({ q: e.target.value })} />
          <select value={f.status} onChange={(e) => upd({ status: e.target.value })}>
            <option value="">كل الحالات</option>{stList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {isMgr && (
            <select value={f.asg} onChange={(e) => upd({ asg: e.target.value })}>
              <option value="">كل الموظفين</option><option value="_">غير موزّعة</option>
              {emps.map((e) => <option key={e.uid} value={e.uid}>{e.name}</option>)}
            </select>
          )}
          <select value={f.fu} onChange={(e) => upd({ fu: e.target.value })}>
            {[["", "كل المتابعات"], ["today", "اليوم"], ["over", "متأخرة"], ["none", "بدون موعد"]].map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
          <span className="grow" /><button onClick={exportClaims}>تصدير إكسل</button>
        </div>
        {isMgr && (
          <div className="row" style={{ marginTop: 10 }}>
            {!sel.size ? (
              <><span className="muted small">حدّد مطالبات لنقلها بين الموظفين.</span> <button className="sm" onClick={async () => { try { setSel(new Set(await rpc<string[]>("claims_ids", { p_project: ctx.pid, p_q: f.q, p_status: f.status, p_asg: f.asg, p_fu: f.fu }))); } catch (e) { ctx.toast(errMsg(e), true); } }}>تحديد كل النتائج ({pageData.total})</button></>
            ) : (
              <>
                <b>{sel.size} محددة</b>
                <select value={bulkTo} onChange={(e) => setBulkTo(e.target.value)}>
                  <option value="">— غير موزّعة —</option>{emps.map((e) => <option key={e.uid} value={e.uid}>{e.name}</option>)}
                </select>
                <button className="pri sm" onClick={async () => { await ctx.transfer([...sel], bulkTo || null); setSel(new Set()); }}>نقل المحدد</button>
                <button className="sm" onClick={() => setSel(new Set())}>إلغاء التحديد</button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="tw">
        <table className="cards">
          <thead><tr>
            {isMgr && <th><input type="checkbox" checked={rows.length > 0 && rows.every((c) => sel.has(c.id))} onChange={(e) => { const s = new Set(sel); rows.forEach((c) => (e.target.checked ? s.add(c.id) : s.delete(c.id))); setSel(s); }} /></th>}
            <th title="المفضلة">★</th>            {cols.map((c) => <th key={c}>{c}</th>)}<th>المتبقي</th>{isMgr && <th>الموظف</th>}<th>الحالة</th><th>موعد المتابعة</th><th>ملاحظة</th><th>آخر تعديل</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map((c) => {
              const st = stOf(c), k = calc(c);
              return (
                <tr key={c.id} className="rowopen" title="انقر مرتين لفتح التفاصيل" onClick={(e) => rowTap(e, c.id, () => openClaim(c.id))}>
                  {isMgr && <td data-label=""><input type="checkbox" checked={sel.has(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} /></td>}
                  <td data-label=""><button className={"star" + (ctx.favSet.has(c.id) ? " on" : "")} title={ctx.favSet.has(c.id) ? "إزالة من المفضلة" : "إضافة للمفضلة"} onClick={() => ctx.toggleFav(c.id)}><Star size={17} /></button></td>
                  {cols.map((n) => <td key={n} data-label={n} className="copycell" title="اضغط للنسخ" onClick={() => scheduleCopy(c.data?.[n], ctx.toast)}>{c.data?.[n]}</td>)}
                  <td data-label="المتبقي">{L.money(k.rem)}</td>
                  {isMgr && (
                    <td data-label="الموظف">
                      <select value={c.assignee || ""} onChange={(e) => ctx.transfer([c.id], e.target.value || null)}>
                        <option value="">— غير موزّعة —</option>
                        {emps.map((e) => <option key={e.uid} value={e.uid}>{e.name}</option>)}
                        {c.assignee && !emps.find((e) => e.uid === c.assignee) && <option value={c.assignee}>{userName(c.assignee)}</option>}
                      </select>
                    </td>
                  )}
                  <td data-label="الحالة">
                    <span className="pill" style={{ background: st.color }}>{st.name}</span>{c.coded && <span className="pill" style={{ background: "#7c3aed", marginInlineStart: 6 }}>مكود</span>}
                  </td>
                  <td data-label="موعد المتابعة">{c.follow_up_date || "—"}</td>
                  <td data-label="ملاحظة" className="small">{c.last_note || "—"}</td>
                  <td data-label="آخر تعديل" className="muted small">{fmtTs(c.updated_at)}{c.updated_by_name && <><br />{c.updated_by_name}</>}</td>
                  <td data-label=""><button className="sm" onClick={() => openClaim(c.id)}>تفاصيل</button></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={20} className="center muted">لا توجد مطالبات</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button disabled={page === 0} onClick={() => upd({ page: page - 1 })}>السابق</button>
        <span className="muted">{pageData.total} مطالبة — صفحة {page + 1} من {pages}{loading ? " …" : ""}</span>
        <button disabled={page >= pages - 1} onClick={() => upd({ page: page + 1 })}>التالي</button>
      </div>
    </>
  );
}

function ClaimModal({ c, title, st, stList, stAll, k, assigneeName, onClose, onSave, initialStatus, canReview, onReviewed, meId, canRequestCoding, columns, canEditData, canEditCol, canDeleteHist, onSaveData, fav, onFav }: {
  fav?: boolean; onFav?: () => void;
  c: Claim; title: string; st: Status; stList: Status[]; stAll: Status[]; k: { amt: number; paid: number; rem: number }; assigneeName: string;
  initialStatus?: string | undefined; canReview: boolean; onReviewed: () => void; meId: string; canRequestCoding: boolean;
  columns: string[]; canEditData: boolean; canEditCol: (col: string) => boolean; canDeleteHist: boolean; onSaveData: (d: Record<string, string>) => Promise<void>;
  onClose: () => void; onSave: (p: { status: string; followUpDate: string; note: string }, payment?: PaymentInput, data?: Record<string, string>) => Promise<boolean>;
}) {
  const initId = initialStatus || c.status || st.id;
  const initRow = stAll.find((x) => x.id === initId);
  const [top, setTop] = useState(initRow?.parent || initRow?.id || st.id);
  const [sub, setSub] = useState(initRow?.parent ? initRow.id : "");
  const subs = stAll.filter((x) => x.parent === top);
  const status = sub && subs.some((x) => x.id === sub) ? sub : top;
  const [dataEdits, setDataEdits] = useState<Record<string, string>>({});
  const [payment, setPayment] = useState<PaymentInput>();
  const [busy, setBusy] = useState(false);
  const kind = paymentKind(stAll.find(s => s.id === status));
  const capturePayment = useCallback((p: PaymentInput) => setPayment(p), []);
  const [fu, setFu] = useState(c.follow_up_date || "");
  const [note, setNote] = useState(c.note || "");
  const [hist, setHist] = useState<History[] | null>(null);
  const [hErr, setHErr] = useState("");
  useEffect(() => {
    supabase.from("claim_history").select("id, at, by_name, type, changes").eq("project_id", c.project_id).eq("claim_id", c.id).order("at", { ascending: false })
      .then(({ data, error }) => { if (error) setHErr(errMsg(error)); else setHist((data || []) as unknown as History[]); });
  }, [c.id, c.project_id]);
  return (
    <>
      <div className="row"><h3 className="grow">{title}</h3>{onFav && <FavToggle on={!!fav} onToggle={onFav} />}<button onClick={onClose}>إغلاق</button></div>
      <CodingBox c={c} canRequest={canRequestCoding} />
      <div className="tw" style={{ marginBottom: 12 }}>
        <table><tbody>
          {[...new Set([...columns, ...Object.keys(c.data || {})])].map((a) => (
            <tr key={a}><th>{a}</th><td style={{ whiteSpace: "normal" }}>
              {canEditData && canEditCol(a)
                ? <input defaultValue={c.data?.[a] || ""} placeholder="—" onChange={(e) => setDataEdits((p) => ({ ...p, [a]: e.target.value }))} />
                : (c.data?.[a] || "")}
            </td></tr>
          ))}
          <tr><th>المبلغ / المسدّد / المتبقي</th><td>{L.money(k.amt)} / {L.money(k.paid)} / {L.money(k.rem)}</td></tr>
          <tr><th>الموظف</th><td>{assigneeName}</td></tr>
        </tbody></table>
      </div>
      <div className="form">
        <label>الحالة<select value={top} onChange={(e) => { setTop(e.target.value); setSub(""); setPayment(undefined); }}>{stList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        {subs.length > 0 && <label>النوع<select value={status} onChange={(e) => { setSub(e.target.value === top ? "" : e.target.value); setPayment(undefined); }}>
          <option value={top}>{top === "s_paid" ? "سداد كامل" : "بدون تحديد"}</option>
          {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>}
        {kind && <PaymentFields key={status} kind={kind} remaining={k.rem} onChange={capturePayment} />}
        <label>موعد المتابعة<input type="date" readOnly={kind === "scheduled"} value={kind === "scheduled" && payment ? nextMonthDate(payment.date) : fu} onChange={(e) => setFu(e.target.value)} /></label>
        <label>ملاحظة<textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <Button className="pri" disabled={busy || !!kind && (!payment || payment.amount <= 0 || payment.amount > k.rem || (kind === "discount" && (payment.discount == null || payment.discount < 0 || payment.discount > 100)))} onClick={async () => { setBusy(true); try { await onSave({ status, followUpDate: fu, note: note.trim() }, kind ? payment : undefined, canEditData ? dataEdits : undefined); } finally { setBusy(false); } }}>{kind ? "إرسال لموافقة المشرف" : "حفظ"}</Button>
      </div>
      <PaymentReview projectId={c.project_id} claimId={c.id} meId={meId} canReview={canReview} canDelete={canDeleteHist} onReviewed={onReviewed} />
      <h3 style={{ marginTop: 16 }}>سجل التعديلات</h3>
      <div className={`tl ${hist ? "" : "muted"}`}>
        {hErr || (!hist ? "جاري التحميل…" : hist.length ? hist.map((h) => (
          <div key={h.id}>
            <b>{h.by_name || ""}</b> <span className="muted small">{fmtTs(h.at)}</span>
            {canDeleteHist && <button style={{ marginInlineStart: 8 }} onClick={async () => { if (!window.confirm("حذف هذا السجل نهائيًا؟")) return; const { error } = await supabase.from("claim_history").delete().eq("id", h.id); if (error) toast(errMsg(error), true); else setHist((p) => (p || []).filter((x) => x.id !== h.id)); }}>حذف</button>}
            <br />
            {Object.entries(h.changes || {}).map(([fld, [a, b]]) => (
              <div key={fld}>{FIELD_LABEL[fld] || fld.replace(/^data:/, "")}: <s className="muted">{a || "—"}</s> ← <b>{b || "—"}</b></div>
            ))}
          </div>
        )) : <span className="muted">لا توجد تعديلات بعد</span>)}
      </div>
    </>
  );
}

/* ---------- payments approval (the claims behind the pending payments are fetched by id for their labels) ---------- */
function PaymentsView({ ctx, projectId, canReview, onReviewed }: { ctx: Ctx; projectId: string; canReview: boolean; onReviewed: () => void }) {
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [k, setK] = useState(0);
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const { data } = await supabase.from("claim_payments").select("claim_id").eq("project_id", projectId).eq("state", "pending").limit(1000);
        const ids = [...new Set((data || []).map((r) => r.claim_id))];
        const mp = new Map<string, string>();
        const idCol = ctx.project?.mapping?.["id"];
        for (const part of chunk(ids, 300)) {
          const d = await rpc<ClaimsPage>("claims_page", { p_project: projectId, p_ids: part, p_limit: 300 });
          for (const c of d.rows) mp.set(c.id, (idCol && c.data?.[idCol]) || ctx.claimTitle(c));
        }
        if (!off) setLabels(mp);
      } catch { /* labels are cosmetic */ }
    })();
    return () => { off = true; };
  }, [projectId, k, ctx.tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return <PaymentReview projectId={projectId} meId={ctx.me.uid} canReview={canReview} canDelete={ctx.isMgr} onReviewed={() => { setK((x) => x + 1); onReviewed(); }} claimLabel={(cid) => labels.get(cid) || cid} />;
}

/* ---------- reminders ---------- */
function Reminders({ ctx, openClaim }: { ctx: Ctx; openClaim: (id: string) => void }) {
  const { isMgr, employees, today } = ctx;
  const [rf, setRf] = useState("");
  const [data, setData] = useState<{ total: number; rows: ClaimRow[] } | null>(null);
  useEffect(() => {
    if (!ctx.pid) return;
    let off = false;
    rpc<{ total: number; unseen: number; rows: ClaimRow[] }>("claims_due", { p_project: ctx.pid, p_asg: isMgr ? rf : "", p_limit: 1000, p_offset: 0 })
      .then((d) => { if (off) return; ctx.register(d.rows); setData(d); }, (e) => { if (!off) toast(errMsg(e), true); });
    return () => { off = true; };
  }, [ctx.pid, rf, isMgr, ctx.tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const list: Claim[] = data?.rows || [];
  const over = list.filter((c) => c.follow_up_date < today), now = list.filter((c) => c.follow_up_date === today);
  const table = (arr: Claim[], late: boolean) => (
    <div className="tw"><table className="cards">
      <thead><tr><th>الموعد</th>{isMgr && <th>الموظف</th>}<th>المطالبة</th><th>المتبقي</th><th>الحالة</th><th>آخر ملاحظة</th><th></th></tr></thead>
      <tbody>
        {arr.map((c) => {
          const st = ctx.stOf(c), d = L.daysBetween(c.follow_up_date, today);
          return (
            <tr key={c.id} className="rowopen" title="انقر مرتين لفتح التفاصيل" onClick={(e) => rowTap(e, c.id, () => openClaim(c.id))}>
              <td data-label="الموعد" className={late ? "late" : ""}>{c.follow_up_date}{late && ` (متأخرة ${d} يوم)`}</td>
              {isMgr && <td data-label="الموظف">{ctx.userName(c.assignee)}</td>}
              <td data-label="المطالبة">{ctx.claimTitle(c)}</td>
              <td data-label="المتبقي">{L.money(ctx.calc(c).rem)}</td>
              <td data-label="الحالة"><span className="pill" style={{ background: st.color }}>{st.name}</span></td>
              <td data-label="آخر ملاحظة" style={{ whiteSpace: "normal" }}>{c.last_note}</td>
              <td data-label=""><button className="sm" onClick={() => openClaim(c.id)}>فتح</button></td>
            </tr>
          );
        })}
        {!arr.length && <tr><td colSpan={9} className="center muted">لا يوجد</td></tr>}
      </tbody>
    </table></div>
  );
  return (
    <>
      {isMgr && <div className="card"><select value={rf} onChange={(e) => setRf(e.target.value)}><option value="">كل الموظفين</option>{employees.map((e) => <option key={e.uid} value={e.uid}>{e.name}</option>)}</select></div>}
      <h3 className="late">متأخرة ({over.length})</h3>{table(over, true)}
      <h3 style={{ marginTop: 18 }}>مستحقة اليوم ({now.length})</h3>{table(now, false)}
    </>
  );
}

/* ---------- dashboard ---------- */
type DashEmp = { uid: string | null; name: string; claims: number; required: number; collected: number; remaining: number; closed: number };
type DashStatus = { status_id: string; name: string; color: string; claims: number; remaining: number };

function Dashboard({ ctx, saveXlsx, fetchAll, onExportClaims }: {
  ctx: Ctx; saveXlsx: (rows: Record<string, unknown>[], name: string) => void;
  fetchAll: (args: Record<string, unknown>) => Promise<Claim[]>; onExportClaims: (list: Claim[], name: string) => void;
}) {
  const pid = ctx.pid;
  const emp = useRpc<DashEmp[]>("report_employees", { p_project: pid, p_from: null, p_to: null }, !!pid, ctx.tick);
  const dist = useRpc<DashStatus[]>("report_status_dist", { p_project: pid, p_employee: null }, !!pid, ctx.tick);
  const rows = emp.data || [];
  const T = rows.reduce((a, r) => ({ n: a.n + r.claims, tot: a.tot + r.required, paid: a.paid + r.collected, rem: a.rem + r.remaining, closed: a.closed + r.closed }), { n: 0, tot: 0, paid: 0, rem: 0, closed: 0 });
  const pct = (r: { tot: number; paid: number }) => (r.tot ? Math.round((r.paid / r.tot) * 1000) / 10 : 0);
  const [stF, setStF] = useState("");
  const [sp, setSp] = useState(0);
  useEffect(() => { setSp(0); }, [stF, pid]);
  const selStatus = dist.data?.find((s) => s.status_id === stF);
  const sel = useRpc<ClaimsPage>("claims_page", { p_project: pid, p_status: stF, p_limit: 50, p_offset: sp * 50 }, !!pid && !!stF, ctx.tick);
  useEffect(() => { if (sel.data) ctx.register(sel.data.rows); }, [sel.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const exportSummary = () => {
    if (!ctx.project) return;
    saveXlsx(rows.map((r) => ({ "الموظف": r.name, "المطالبات": r.claims, "المبلغ الكلي": r.required, "المسدّد": r.collected, "المتبقي": r.remaining, "نسبة الإنجاز %": pct({ tot: r.required, paid: r.collected }), "مغلقة": r.closed })), "لوحة-" + ctx.project.name);
  };
  return (
    <>
      {(emp.error || dist.error) && <p className="err" role="alert">{emp.error || dist.error}</p>}
      <div className="stats">
        <div className="stat"><span className="muted">المطالبات</span><b>{T.n}</b></div>
        <div className="stat"><span className="muted">المبلغ الكلي</span><b>{L.money(T.tot)}</b></div>
        <div className="stat"><span className="muted">المسدّد</span><b>{L.money(T.paid)}</b></div>
        <div className="stat"><span className="muted">المتبقي</span><b>{L.money(T.rem)}</b></div>
        <div className="stat"><span className="muted">نسبة الإنجاز</span><b>{pct(T)}%</b></div>
      </div>
      <div className="card row">
        <span className="muted small">اضغط على حالة لعرض مطالباتها:</span>
        {(dist.data || []).map((s) => (
          <button key={s.status_id} type="button" className={"pillbtn" + (stF === s.status_id ? " on" : "")} style={{ background: s.color }} onClick={() => setStF(stF === s.status_id ? "" : s.status_id)}>
            {s.name}: {s.claims}
          </button>
        ))}
        <span className="grow" /><button onClick={exportSummary}>تصدير الملخص</button>
      </div>
      {ctx.project && <DailyFollowups pid={ctx.project.id} />}
      {selStatus && (
        <StatusClaims ctx={ctx} status={{ id: selStatus.status_id, name: selStatus.name, color: selStatus.color, closed: false, paid: false }}
          list={sel.data?.rows || []} total={sel.data?.total ?? selStatus.claims} page={sp} setPage={setSp}
          onExport={async () => { try { onExportClaims(await fetchAll({ p_status: stF }), `مطالبات-${selStatus.name}-${ctx.project?.name || ""}`); } catch (e) { ctx.toast(errMsg(e), true); } }} />
      )}
      <div className="tw"><table className="cards">
        <thead><tr><th>الموظف</th><th>المطالبات</th><th>المبلغ الكلي</th><th>المسدّد</th><th>المتبقي</th><th>نسبة الإنجاز</th><th>مغلقة</th></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const x = { tot: r.required, paid: r.collected };
            return (
              <tr key={r.uid || "_" + i}>
                <td data-label="الموظف">{r.name}</td><td data-label="المطالبات">{r.claims}</td><td data-label="المبلغ الكلي">{L.money(r.required)}</td>
                <td data-label="المسدّد">{L.money(r.collected)}</td><td data-label="المتبقي">{L.money(r.remaining)}</td>
                <td data-label="نسبة الإنجاز"><div className="row"><div className="bar grow"><i style={{ width: `${Math.min(100, pct(x))}%` }} /></div><b>{pct(x)}%</b></div></td>
                <td data-label="مغلقة">{r.closed}</td>
              </tr>
            );
          })}
          <tr className="tot"><td>الإجمالي</td><td>{T.n}</td><td>{L.money(T.tot)}</td><td>{L.money(T.paid)}</td><td>{L.money(T.rem)}</td><td>{pct(T)}%</td><td>{T.closed}</td></tr>
        </tbody>
      </table></div>
    </>
  );
}

function DailyFollowups({ pid }: { pid: string }) {
  const [day, setDay] = useState(L.todayRiyadh());
  const r = useRpc<{ uid: string; name: string; n: number }[]>("report_daily_followups", { p_project: pid, p_day: day });
  const rows = r.data ?? null;
  return (
    <div className="card">
      <div className="row"><h3 style={{ margin: 0 }}>المتابعات اليومية لكل موظف</h3><span className="grow" /><input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></div>
      <div className="tw" style={{ marginTop: 10 }}><table className="cards">
        <thead><tr><th>الموظف</th><th>عدد المتابعات</th></tr></thead>
        <tbody>
          {r.error ? <tr><td colSpan={2} className="err">{r.error}</td></tr>
            : rows === null ? <tr><td colSpan={2} className="center muted">جارٍ التحميل…</td></tr>
            : rows.length ? rows.map((x, i) => <tr key={i}><td data-label="الموظف">{x.name}</td><td data-label="عدد المتابعات"><b>{x.n}</b></td></tr>)
            : <tr><td colSpan={2} className="center muted">لا توجد متابعات في هذا اليوم</td></tr>}
          {!!rows?.length && <tr className="tot"><td>الإجمالي</td><td>{rows.reduce((a, x) => a + Number(x.n), 0)}</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}

function StatusClaims({ ctx, status, list, total, page, setPage, onExport }: { ctx: Ctx; status: Status; list: Claim[]; total: number; page: number; setPage: (n: number) => void; onExport: () => void }) {
  const cols = ctx.displayCols();
  const span = cols.length + (ctx.isMgr ? 4 : 3);
  const pages = Math.max(1, Math.ceil(total / 50));
  return (
    <div className="card">
      <div className="row">
        <h3 style={{ margin: 0 }}>مطالبات حالة <span className="pill" style={{ background: status.color }}>{status.name}</span> ({total})</h3>
        <span className="grow" /><button className="pri sm" onClick={onExport}>تصدير إكسل</button>
      </div>
      <div className="tw" style={{ marginTop: 10 }}><table className="cards">
        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}<th>المتبقي</th>{ctx.isMgr && <th>الموظف</th>}<th>موعد المتابعة</th><th>ملاحظة</th></tr></thead>
        <tbody>
          {list.map((c) => (
            <tr key={c.id} className="rowopen" title="انقر مرتين لفتح التفاصيل" onClick={(e) => rowTap(e, c.id, () => ctx.openClaim(c.id))}>
              {cols.map((n) => <td key={n} data-label={n} className="copycell" title="اضغط للنسخ" onClick={() => scheduleCopy(c.data?.[n], ctx.toast)}>{c.data?.[n]}</td>)}
              <td data-label="المتبقي">{L.money(ctx.calc(c).rem)}</td>
              {ctx.isMgr && <td data-label="الموظف">{ctx.userName(c.assignee)}</td>}
              <td data-label="موعد المتابعة">{c.follow_up_date || "—"}</td>
              <td data-label="ملاحظة" style={{ whiteSpace: "normal" }}>{c.last_note}</td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan={span} className="center muted">لا توجد مطالبات بهذه الحالة</td></tr>}
        </tbody>
      </table></div>
      {pages > 1 && (
        <div className="pager">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>السابق</button>
          <span className="muted">صفحة {page + 1} من {pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>التالي</button>
        </div>
      )}
    </div>
  );
}

/* ---------- upload & distribute ---------- */
type Up = { wb: XLSX.WorkBook; file: string; sheet: string; headers: string[]; rows: Record<string, string>[] };
type ImpRow = { id: string; data: Record<string, string>; amount: number; paid: number; has_id: boolean };
type DistRow = { uid: string; cur_count: number; cur_sum: number; add_count: number; add_sum: number };
type ProjectStats = { total: number; unassigned_count: number; unassigned_sum: number; movable_count: number; loads: { uid: string; count: number; sum: number }[]; batches: { id: string; count: number; sum: number }[] };

function DataView({ ctx, reloadClaims }: { ctx: Ctx; reloadClaims: () => Promise<void> }) {
  const { employees: emps, project, pid } = ctx;
  const [up, setUp] = useState<Up | null>(null);
  const [m, setM] = useState({ amount: "", paid: "", remaining: "", id: "" });
  const [res, setRes] = useState<{ rows: ImpRow[]; add: number; upd: number; dup: number; bad: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /* Counts, per-employee loads and uploaded files come from the database (project_stats), not from loading every claim. */
  const [stats, setStats] = useState<ProjectStats | null>(null);
  useEffect(() => {
    if (!pid) return;
    let off = false;
    rpc<ProjectStats>("project_stats", { p_project: pid }).then((d) => { if (!off) setStats(d); }, (e) => { if (!off) toast(errMsg(e), true); });
    return () => { off = true; };
  }, [pid, ctx.tick]);
  const total = stats?.total ?? 0, unCount = stats?.unassigned_count ?? 0, unSum = stats?.unassigned_sum ?? 0;
  const [off, setOff] = useState<Set<string>>(new Set());
  const targets = emps.filter((e) => !off.has(e.uid));

  function loadSheet(wb: XLSX.WorkBook, file: string, name: string) {
    const ws = wb.Sheets[name]!;
    const arr = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "", dateNF: "yyyy-mm-dd" });
    setRes(null);
    if (arr.length < 2) { setUp(null); toast("الملف فارغ أو بلا صفوف بيانات.", true); return; }
    const headers = L.sanitizeHeaders(arr[0] as unknown[]);
    const rows = arr.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, String((r as unknown[])[i] ?? "").trim()])));
    const sm = project?.mapping || {};
    const guess = (re: RegExp) => headers.find((h) => re.test(h)) || "";
    const pre = (key: string, re: RegExp | null): string => { const v = sm[key]; return v && headers.includes(v) ? v : re ? guess(re) : ""; };
    setM({
      amount: pre("amount", /مبلغ|قيمة|amount|total|إجمالي|اجمالي/i) || headers[0] || "",
      paid: pre("paid", /مسدد|سداد|مدفوع|paid/i), remaining: pre("remaining", /متبقي|remaining|رصيد|balance/i), id: pre("id", null),
    });
    setUp({ wb, file, sheet: name, headers, rows });
  }

  async function onFile(file?: File) {
    if (!file) return;
    if (file.size > L.MAX_UPLOAD_BYTES) { toast("حجم الملف كبير جدًا (الحد الأقصى 25 ميجابايت). قسّمه إلى ملفات أصغر.", true); if (fileRef.current) fileRef.current.value = ""; return; }
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      loadSheet(wb, file.name, wb.SheetNames[0] || "");
    } catch (e) { toast("تعذّرت قراءة الملف: " + errMsg(e), true); }
  }

  /** Parses the sheet (in the browser — the file lives there) then asks the database to classify new / changed / unchanged rows. */
  async function analyze() {
    if (!up || !pid) return;
    setBusy(true);
    try {
      const seen = new Set<string>(), rows: ImpRow[] = [];
      let dup = 0, bad = 0;
      for (const r of up.rows) {
        const vals = up.headers.map((h) => r[h]);
        if (vals.every((v) => !v)) continue;
        const idv = m.id ? r[m.id] : "";
        const key = idv ? "k_" + (await L.hashStr(idv)) : "r_" + (await L.hashStr(vals.join("\u0001")));
        if (seen.has(key)) { dup++; continue; }
        seen.add(key);
        let amount = L.parseAmount(r[m.amount]);
        if (Number.isNaN(amount)) { bad++; amount = 0; }
        let paid = 0;
        if (m.paid) { const p = L.parseAmount(r[m.paid]); paid = Number.isNaN(p) ? 0 : p; }
        else if (m.remaining) { const rm = L.parseAmount(r[m.remaining]); paid = Number.isNaN(rm) ? 0 : Math.max(amount - rm, 0); }
        rows.push({ id: key, data: r, amount, paid, has_id: !!idv });
      }
      const out = await rpc<{ added: number; updated: number; unchanged: number }>("import_claims", { p_project: pid, p_rows: rows, p_columns: up.headers, p_mapping: m, p_batch: "preview", p_apply: false });
      setRes({ rows, add: out.added, upd: out.updated, dup: dup + out.unchanged, bad });
    } catch (e) { toast(errMsg(e), true); }
    setBusy(false);
  }

  /** One database operation: either every row is saved (with the project's columns) or nothing is. */
  async function doImport() {
    if (!res || !up || !pid || !project) return;
    if (!m.amount) return toast("اختر عمود المبلغ", true);
    setBusy(true);
    try {
      toast("جاري الرفع…");
      const out = await rpc<{ added: number; updated: number }>("import_claims", { p_project: pid, p_rows: res.rows, p_columns: up.headers, p_mapping: m, p_batch: "b" + Date.now(), p_apply: true });
      ctx.reloadProjects();
      toast(`تم: ${out.added} جديدة، ${out.updated} محدَّثة`);
      setUp(null); setRes(null); if (fileRef.current) fileRef.current.value = "";
      await reloadClaims();
    } catch (e) { toast(errMsg(e), true); }
    setBusy(false);
  }


  /** Distribution happens in the database in one step. The same seed gives the same result, so what the preview shows is what gets saved. */
  async function plan() {
    if (!targets.length || !unCount || !pid) return;
    const seed = Math.round((Math.random() * 2 - 1) * 1e6) / 1e6;
    const uids = targets.map((e) => e.uid);
    try {
      const preview = await rpc<DistRow[]>("distribute_claims", { p_project: pid, p_employees: uids, p_scope: "unassigned", p_seed: seed, p_apply: false });
      const apply = async () => {
        ctx.setModal(null);
        try {
          const done = await rpc<DistRow[]>("distribute_claims", { p_project: pid, p_employees: uids, p_scope: "unassigned", p_seed: seed, p_apply: true });
          toast(`تم توزيع ${done.reduce((a, r) => a + r.add_count, 0)} مطالبة`);
          await reloadClaims();
        } catch (e) { toast(errMsg(e), true); }
      };
      ctx.setModal(
        <>
          <h3>معاينة التوزيع ({unCount} مطالبة)</h3>
          <div className="tw"><table>
            <thead><tr><th>الموظف</th><th>الحالي (عدد / مبلغ)</th><th>الجديد</th><th>بعد التوزيع</th></tr></thead>
            <tbody>{preview.map((l) => (
              <tr key={l.uid}><td>{ctx.userName(l.uid)}</td><td>{l.cur_count} / {L.money(l.cur_sum)}</td><td>+{l.add_count} / {L.money(l.add_sum)}</td><td><b>{l.cur_count + l.add_count} / {L.money(Number(l.cur_sum) + Number(l.add_sum))}</b></td></tr>
            ))}</tbody>
          </table></div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="pri" onClick={apply}>تأكيد التوزيع</button>
            <button onClick={() => void plan()}>إعادة التوزيع العشوائي</button>
            <button onClick={() => ctx.setModal(null)}>إلغاء</button>
          </div>
        </>,
      );
    } catch (e) { toast(errMsg(e), true); }
  }


  const batches = stats?.batches || [];


  async function deleteBatch(batchId: string) {
    const b = batches.find((x) => x.id === batchId);
    if (!b || !pid) return;
    if (!confirm(`حذف الملف «${batchId}» وكل مطالباته (${b.count} مطالبة بمبلغ ${L.money(b.sum)}) نهائيًا؟`)) return;
    if (!confirm("تأكيد أخير: ستُحذف بيانات الملف وسداداته وسجلاته، وإن لم يبقَ ملف آخر في المشروع تُحذف الأعمدة المعروضة أيضًا فيعود المشروع كأنه أُنشئ للتو. لا يمكن التراجع.")) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("delete_claim_batch", { p_project: pid, p_batch: batchId });
      if (error) throw error;
      toast(`تم حذف ${data ?? b.count} مطالبة`);
      await reloadClaims();
    } catch (e) { toast(errMsg(e), true); }
    setBusy(false);
  }

  async function redistributeAll() {
    const movable = stats?.movable_count ?? 0;
    if (!pid || !targets.length || !movable) return;
    if (!confirm(`إعادة توزيع كل المطالبات (${movable}) عشوائيًا على ${targets.length} موظفًا؟ ستبقى الحالات والملاحظات والسدادات وسجل المتابعات كما هي، ويتغير الموظف المسؤول فقط.`)) return;
    if (!confirm("تأكيد أخير: سيُعاد توزيع كل المطالبات بما فيها المسندة حاليًا، ولا يمكن التراجع.")) return;
    setBusy(true);
    try {
      const done = await rpc<DistRow[]>("distribute_claims", { p_project: pid, p_employees: targets.map((e) => e.uid), p_scope: "all", p_seed: null, p_apply: true });
      toast(`أُعيد توزيع ${done.reduce((a, r) => a + r.add_count, 0)} مطالبة عشوائيًا`);
      await reloadClaims();
    } catch (e) { toast(errMsg(e), true); }
    setBusy(false);
  }


  async function resetAll() {
    if (!pid || !total) return;
    if (!confirm(`إعادة كل بيانات المشروع (${total} مطالبة) لحالة البداية؟ سترجع الحالات إلى «جديد» وتُمسح الملاحظات ومواعيد المتابعة وكل السدادات.`)) return;
    if (!confirm("تأكيد أخير: لا يمكن التراجع عن مسح السدادات والملاحظات.")) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("reset_project_claims", { p_project: pid });
      if (error) throw error;
      toast(`أُعيدت ${data ?? total} مطالبة لحالة البداية`);
      await reloadClaims();
    } catch (e) { toast(errMsg(e), true); }
    setBusy(false);
  }

  const opt = (req: boolean) => (<>{!req && <option value="">— بدون —</option>}{up!.headers.map((h) => <option key={h} value={h}>{h}</option>)}</>);
  return (
    <>
      <div className="card">
        <h3>١. رفع ملف إكسل</h3>
        <p className="muted small">أي ملف بأي أعمدة. الصفوف المكرّرة تمامًا تُحفظ مرة واحدة. لتحديث المسدّد في ملف لاحق اختر «عمود المعرّف» (مثل رقم المطالبة) فتتحدّث البيانات دون المساس بالتوزيع والحالة والملاحظات.</p>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => onFile(e.target.files?.[0])} />
        {up && (
          <div className="form" style={{ marginTop: 12 }}>
            {up.wb.SheetNames.length > 1 && <label>الورقة<select value={up.sheet} onChange={(e) => loadSheet(up.wb, up.file, e.target.value)}>{up.wb.SheetNames.map((n) => <option key={n}>{n}</option>)}</select></label>}
            <p className="muted small">{up.rows.length} صف في «{up.file}» — حدّد معنى الأعمدة:</p>
            <label>عمود المبلغ الكلي (مطلوب)<select value={m.amount} onChange={(e) => setM({ ...m, amount: e.target.value })}>{opt(true)}</select></label>
            <label>عمود المسدّد (اختياري)<select value={m.paid} onChange={(e) => setM({ ...m, paid: e.target.value })}>{opt(false)}</select></label>
            <label>عمود المتبقي (اختياري، يُستخدم إذا لم يوجد المسدّد)<select value={m.remaining} onChange={(e) => setM({ ...m, remaining: e.target.value })}>{opt(false)}</select></label>
            <label>عمود المعرّف (اختياري، لتحديث مطالبات موجودة)<select value={m.id} onChange={(e) => setM({ ...m, id: e.target.value })}>{opt(false)}</select></label>
            <button onClick={analyze}>معاينة الاستيراد</button>
            {res && (
              <div className="card" style={{ margin: "10px 0 0" }}>
                <b>الناتج:</b> جديدة <b>{res.add}</b> · محدَّثة <b>{res.upd}</b> · مكرّرة/بلا تغيير <b>{res.dup}</b>
                {res.bad > 0 && <div className="late">{res.bad} صف مبلغه فارغ أو غير مفهوم (سيُحفظ بمبلغ 0)</div>}
                <div style={{ marginTop: 8 }}><button className="pri" disabled={busy || !(res.add || res.upd)} onClick={doImport}>تأكيد الاستيراد</button></div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="card">
        <h3>٢. توزيع المطالبات غير الموزّعة</h3>
        <div className="stats">
          <div className="stat"><span className="muted">غير موزّعة</span><b>{unCount}</b></div>
          <div className="stat"><span className="muted">مبلغها</span><b>{L.money(unSum)}</b></div>
          <div className="stat"><span className="muted">موظفون نشطون</span><b>{emps.length}</b></div>
        </div>
        <div className="row" style={{ marginBottom: 8 }}>
          {emps.map((e) => (
            <label key={e.uid} className="chk"><input type="checkbox" checked={!off.has(e.uid)} onChange={(ev) => setOff((prev) => { const n = new Set(prev); if (ev.target.checked) n.delete(e.uid); else n.add(e.uid); return n; })} /> {e.name}</label>
          ))}
        </div>
        <p className="muted small">الموظفون المحدّدون فقط سيُوزَّع عليهم.</p>
        <button className="pri" disabled={!(unCount && targets.length)} onClick={() => void plan()}>وزّع الآن</button>
        <p className="muted small">التوزيع عشوائي ومتوازن في العدد والمبلغ، ولا يغيّر المطالبات الموزّعة سابقًا. ستظهر معاينة قبل الحفظ.</p>
      </div>
      <div className="card">
        <h3>٣. إدارة الملفات والبيانات</h3>
        {batches.length > 0 && (
          <div className="tw" style={{ marginBottom: 12 }}><table>
            <thead><tr><th>الملف الموزّع</th><th>المطالبات</th><th>المبلغ</th><th></th></tr></thead>
            <tbody>{batches.map((b) => (
              <tr key={b.id}>
                <td dir="ltr">{b.id}</td>
                <td>{b.count}</td>
                <td>{L.money(b.sum)}</td>
                <td><button className="sm dng" disabled={busy} onClick={() => deleteBatch(b.id)}>حذف الملف</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <div className="row">
          <button disabled={busy || !(total && emps.length) || targets.length === 0} onClick={redistributeAll}>إعادة التوزيع عشوائيًا للكل</button>
          <button className="dng" disabled={busy || !total} onClick={resetAll}>إعادة البيانات لحالة البداية</button>
        </div>
        <p className="muted small">«إعادة التوزيع» تعيد توزيع كل المطالبات عشوائيًا على الموظفين كما هي عليه الآن — دون تغيير الحالات أو الملاحظات أو السدادات أو سجل المتابعات. «إعادة البيانات» ترجع كل المطالبات لحالة «جديد» وتمسح الملاحظات ومواعيد المتابعة والسدادات مع إبقاء التوزيع الحالي وسجل المتابعات.</p>
      </div>
    </>
  );
}

/* ---------- team ---------- */
function Team({ ctx }: { ctx: Ctx }) {
  const { me, isTop, users, projects } = ctx;
  const [tf, setTf] = useState("");
  const createFn = useServerFn(createAppUser), updateFn = useServerFn(updateAppUser), deleteFn = useServerFn(deleteAppUser), resetFn = useServerFn(resetAppUserPassword);
  let list = isTop ? users : users.filter((u) => u.role === "employee" && u.projectIds.some((p) => me.projectIds.includes(p)));
  if (tf) list = list.filter((u) => u.projectIds.includes(tf));
  list = [...list].sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar"));
  const pn = (id: string) => projects.find((p) => p.id === id)?.name || "";
  const canEdit = (u: Profile) => u.uid !== me.uid && (me.role === "owner" || (me.role === "exec" ? ["supervisor", "employee"].includes(u.role) : u.role === "employee"));
  const close = () => ctx.setModal(null);

  const ProjChecks = ({ sel }: { sel: string[] }) => (
    <><label>المشاريع</label>
      {projects.length ? projects.map((p) => <label key={p.id} className="chk"><input type="checkbox" name="pj" value={p.id} defaultChecked={sel.includes(p.id)} /> {p.name}</label>) : <span className="muted small">لا توجد مشاريع</span>}
    </>
  );

  function addUser() {
    const roles = ROLES_CAN_ADD[me.role];
    const Form = () => {
      const [err, setErr] = useState("");
      const [busy, setBusy] = useState(false);
      return (
        <><h3>إضافة مستخدم</h3>
          <form className="form" onSubmit={async (e) => {
            e.preventDefault(); const fd = new FormData(e.currentTarget);
            const role = String(fd.get("r")) as Role, projectIds = fd.getAll("pj").map(String);
            if (["supervisor", "employee"].includes(role) && !projectIds.length) return setErr("اختر مشروعًا واحدًا على الأقل");
            setBusy(true);
            try {
              await createFn({ data: { name: String(fd.get("n")), username: String(fd.get("u")).trim(), password: String(fd.get("p")), role, projectIds } });
              close(); toast("تم إنشاء المستخدم. سلّمه اسم المستخدم وكلمة المرور."); ctx.reloadUsers();
            } catch (er) { setErr(errMsg(er)); }
            setBusy(false);
          }}>
            <label>الاسم<input name="n" required /></label>
            <label>اسم المستخدم (إنجليزي أو أرقام)<input name="u" dir="ltr" required pattern="[A-Za-z0-9._\-]{3,30}" /></label>
            <label>كلمة المرور (8 أحرف على الأقل)<input name="p" type="text" dir="ltr" minLength={8} required /></label>
            <label>الدور<select name="r" defaultValue="employee">{roles.map((r) => <option key={r} value={r}>{L.ROLE_LABEL[r]}</option>)}</select></label>
            <ProjChecks sel={ctx.pid ? [ctx.pid] : []} />
            <div className="err">{err}</div>
            <div className="row"><button className="pri" disabled={busy}>إنشاء</button><button type="button" onClick={close}>إلغاء</button></div>
          </form></>
      );
    };
    ctx.setModal(<Form />);
  }

  function editUser(u: Profile) {
    const Form = () => {
      const [err, setErr] = useState("");
      return (
        <><h3>تعديل {u.name}</h3>
          <form className="form" onSubmit={async (e) => {
            e.preventDefault(); const fd = new FormData(e.currentTarget);
            const payload: { uid: string; name: string; active: boolean; projectIds?: string[]; role?: Role } = { uid: u.uid, name: String(fd.get("n")), active: fd.has("a") };
            if (!["owner", "exec"].includes(u.role)) payload.projectIds = fd.getAll("pj").map(String);
            if (me.role === "owner" && fd.get("r")) payload.role = String(fd.get("r")) as Role;
            try { await updateFn({ data: payload }); close(); toast("تم الحفظ"); ctx.reloadUsers(); } catch (er) { setErr(errMsg(er)); }
          }}>
            <label>الاسم<input name="n" defaultValue={u.name} required /></label>
            {me.role === "owner" && <label>الدور<select name="r" defaultValue={u.role}>{(["exec", "supervisor", "employee"] as Role[]).map((r) => <option key={r} value={r}>{L.ROLE_LABEL[r]}</option>)}</select></label>}
            <label className="chk"><input type="checkbox" name="a" defaultChecked={u.active} /> الحساب نشط</label>
            {!["owner", "exec"].includes(u.role) && <ProjChecks sel={u.projectIds} />}
            <div className="err">{err}</div>
            <div className="row"><button className="pri">حفظ</button><button type="button" onClick={close}>إلغاء</button></div>
          </form></>
      );
    };
    ctx.setModal(<Form />);
  }

  function resetPass(u: Profile) {
    const Form = () => {
      const [err, setErr] = useState("");
      const [busy, setBusy] = useState(false);
      return (
        <><h3>تعيين كلمة مرور جديدة لـ {u.name}</h3>
          <form className="form" onSubmit={async (e) => {
            e.preventDefault(); const fd = new FormData(e.currentTarget);
            setBusy(true);
            try { await resetFn({ data: { uid: u.uid, password: String(fd.get("p")) } }); close(); toast("تم تعيين كلمة المرور. سلّمها للمستخدم."); }
            catch (er) { setErr(errMsg(er)); }
            setBusy(false);
          }}>
            <p className="muted small">اسم المستخدم: <b dir="ltr">{u.username}</b></p>
            <label>كلمة المرور الجديدة (8 أحرف على الأقل)<input name="p" type="text" dir="ltr" minLength={8} required /></label>
            <div className="err">{err}</div>
            <div className="row"><button className="pri" disabled={busy}>حفظ</button><button type="button" onClick={close}>إلغاء</button></div>
          </form></>
      );
    };
    ctx.setModal(<Form />);
  }

  async function release(u: Profile) {
    if (!confirm(`إرجاع كل مطالبات «${u.name}» في هذا المشروع إلى قائمة غير الموزّعة؟`)) return;
    if (!ctx.pid) return;
    try {
      const n = await rpc<number>("release_claims", { p_project: ctx.pid, p_from: u.uid });
      toast(n ? `أُرجعت ${n} مطالبة` : "لا توجد مطالبات عند هذا الموظف");
      void ctx.reloadClaims();
    } catch (e) { toast(errMsg(e), true); }
  }

  async function del(u: Profile) {
    if (!confirm(`حذف «${u.name}»؟\nستعود مطالباته إلى قائمة «غير موزّعة». إن كنت قد تحتاجه لاحقًا فالأفضل تعطيله بدل الحذف.`)) return;
    try { const r = await deleteFn({ data: { uid: u.uid } }); toast(`تم الحذف${r.released ? ` وإرجاع ${r.released} مطالبة` : ""}`); ctx.reloadUsers(); }
    catch (e) { toast(errMsg(e), true); }
  }

  return (
    <>
      <div className="card row">
        <button className="pri" onClick={addUser}>+ إضافة مستخدم</button>
        {isTop && <select value={tf} onChange={(e) => setTf(e.target.value)}><option value="">كل المشاريع</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
      </div>
      <div className="tw"><table className="cards">
        <thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الدور</th><th>المشاريع</th><th>الحالة</th><th></th></tr></thead>
        <tbody>
          {list.map((u) => (
            <tr key={u.uid}>
              <td data-label="الاسم">{u.name}</td>
              <td data-label="اسم المستخدم" dir="ltr">{u.username}</td>
              <td data-label="الدور">{L.ROLE_LABEL[u.role]}</td>
              <td data-label="المشاريع" style={{ whiteSpace: "normal" }}>{u.projectIds.map(pn).filter(Boolean).join("، ") || (isTop && ["owner", "exec"].includes(u.role) ? "كل المشاريع" : "—")}</td>
              <td data-label="الحالة">{u.active ? "نشط" : <span className="late">معطّل</span>}</td>
              <td data-label="">{canEdit(u) && <>
                <button className="sm" onClick={() => editUser(u)}>تعديل</button>{" "}
                <button className="sm" onClick={() => resetPass(u)}>كلمة المرور</button>{" "}
                {u.role === "employee" && <><button className="sm" onClick={() => release(u)}>إرجاع مطالباته</button>{" "}</>}
                <button className="sm dng" onClick={() => del(u)}>حذف</button>
              </>}</td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan={6} className="center muted">لا يوجد مستخدمون</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}

/* ---------- settings ---------- */
function Settings({ ctx }: { ctx: Ctx }) {
  const { project, isTop } = ctx;
  const [statuses, setStatuses] = useState<Status[]>(() => JSON.parse(JSON.stringify(ctx.stAll)));
  const [name, setName] = useState(project?.name || "");
  const [newCol, setNewCol] = useState("");
  if (!project) return null;
  const cols = project.columns || [], dc = ctx.displayCols();
  const setS = (id: string, p: Partial<Status>) => setStatuses(statuses.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const BUILTIN_SUBS = ["s_partial", "s_scheduled", "s_discount"];
  /** Is any claim on one of these statuses? Answered by the database. */
  const inUse = async (ids: string[]) => {
    try { return await rpc<boolean>("status_in_use", { p_project: project.id, p_ids: ids }); }
    catch (e) { toast(errMsg(e), true); return true; }
  };
  return (
    <>
      <div className="card">
        <h3>الحالات</h3>
        <p className="muted small">«مغلقة» = لا تظهر في التذكيرات. «سداد كامل» = يتطلب اعتماد مشرف المشروع قبل احتسابه في اللوحة. الحالة الفرعية تظهر للموظف بعد اختيار الحالة الرئيسية.</p>
        {statuses.filter((m) => !m.parent).map((m) => (
          <div key={m.id}>
            <div className="row" style={{ marginBottom: 6 }}>
              <input value={m.name} onChange={(e) => setS(m.id, { name: e.target.value })} />
              <input type="color" value={m.color} onChange={(e) => setS(m.id, { color: e.target.value })} />
              <label className="chk"><input type="checkbox" checked={m.closed} onChange={(e) => setS(m.id, { closed: e.target.checked })} /> مغلقة</label>
              <label className="chk"><input type="checkbox" checked={m.paid} onChange={(e) => setS(m.id, { paid: e.target.checked })} /> سداد كامل</label>
              <button className="sm dng" onClick={async () => {
                if (statuses.filter((x) => !x.parent).length <= 1) return toast("لا بد من حالة واحدة على الأقل", true);
                if (await inUse([m.id, ...statuses.filter((x) => x.parent === m.id).map((x) => x.id)])) return toast("توجد مطالبات بهذه الحالة. غيّر حالتها أولًا.", true);
                setStatuses(statuses.filter((x) => x.id !== m.id && x.parent !== m.id));
              }}>حذف</button>
            </div>
            {statuses.filter((x) => x.parent === m.id).map((x) => (
              <div key={x.id} className="row" style={{ marginBottom: 6, marginInlineStart: 24 }}>
                <input value={x.name} onChange={(e) => setS(x.id, { name: e.target.value })} />
                <input type="color" value={x.color} onChange={(e) => setS(x.id, { color: e.target.value })} />
                <label className="chk"><input type="checkbox" checked={x.closed} onChange={(e) => setS(x.id, { closed: e.target.checked })} /> مغلقة</label>
                {!BUILTIN_SUBS.includes(x.id) && <button className="sm dng" onClick={async () => {
                  if (await inUse([x.id])) return toast("توجد مطالبات بهذه الحالة. غيّر حالتها أولًا.", true);
                  setStatuses(statuses.filter((y) => y.id !== x.id));
                }}>حذف</button>}
              </div>
            ))}
            <div className="row" style={{ marginBottom: 10, marginInlineStart: 24 }}>
              <button className="sm" onClick={() => setStatuses([...statuses, { id: "s_" + Date.now().toString(36), name: "حالة فرعية", color: m.color, closed: m.closed, paid: false, parent: m.id }])}>+ حالة فرعية</button>
            </div>
          </div>
        ))}
        <div className="row" style={{ marginTop: 10 }}>
          <button onClick={() => setStatuses([...statuses, { id: "s_" + Date.now().toString(36), name: "حالة جديدة", color: "#64748b", closed: false, paid: false }])}>+ حالة</button>
          <button className="pri" onClick={async () => { if (await ctx.updateProject({ statuses: statuses.map((s) => ({ ...s, name: s.name.trim() || "حالة" })) })) toast("تم حفظ الحالات"); }}>حفظ الحالات</button>
        </div>
      </div>
      {isTop && (
        <div className="card"><h3>اسم المشروع</h3>
          <div className="row"><input value={name} onChange={(e) => setName(e.target.value)} /><button onClick={async () => { if (await ctx.updateProject({ name: name.trim() })) toast("تم الحفظ"); }}>حفظ</button></div>
        </div>
      )}
      <div className="card"><h3>الأعمدة المعروضة في المتتبع</h3>
        {cols.length ? cols.map((c) => (
          <label key={c} className="chk"><input type="checkbox" checked={dc.includes(c)} onChange={(e) => {
            const next = e.target.checked ? cols.filter((x) => dc.includes(x) || x === c) : dc.filter((x) => x !== c);
            ctx.updateProject({ display_cols: next });
          }} /> {c}</label>
        )) : <span className="muted">ارفع ملفًا أولًا.</span>}
        <div className="row" style={{ marginTop: 10 }}>
          <input placeholder="اسم عمود جديد (مثل: رقم الجوال)" value={newCol} onChange={(e) => setNewCol(e.target.value)} />
          <button className="pri" onClick={async () => {
            const n = newCol.trim();
            if (!n) return;
            if (cols.includes(n)) return toast("هذا العمود موجود مسبقًا", true);
            if (await ctx.updateProject({ columns: [...cols, n], display_cols: [...dc, n], added_columns: [...(project.added_columns || []), n] })) { setNewCol(""); toast("تمت إضافة العمود"); }
          }}>+ إضافة عمود</button>
        </div>
        <p className="muted small">العمود الجديد يظهر فورًا في المتتبع وتفاصيل المطالبة وتصدير إكسل، وتُعبّأ قيمته من تفاصيل المطالبة (للمدراء) أو برفع ملف يتضمّنه.</p>
      </div>
    </>
  );
}

/* ---------- projects (owner) ---------- */
function Projects({ ctx }: { ctx: Ctx }) {
  const [name, setName] = useState("");
  return (
    <>
      <div className="card"><h3>مشروع جديد</h3>
        <div className="row">
          <input placeholder="اسم المشروع" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="pri" onClick={async () => {
            if (!name.trim()) return;
            const { error } = await supabase.from("projects").insert({ name: name.trim(), statuses: L.DEFAULT_STATUSES as any, created_by: ctx.me.uid });
            if (error) return toast(errMsg(error), true);
            setName(""); toast("تم إنشاء المشروع"); ctx.reloadProjects();
          }}>إنشاء</button>
        </div>
      </div>
      <div className="tw"><table>
        <thead><tr><th>المشروع</th><th>الأعمدة</th><th></th></tr></thead>
        <tbody>
          {ctx.projects.map((p) => (
            <tr key={p.id}><td>{p.name}</td><td>{(p.columns || []).length}</td>
              <td><button className="sm dng" onClick={async () => {
                if (!confirm(`حذف المشروع «${p.name}» وكل مطالباته نهائيًا؟`) || !confirm("تأكيد أخير: لا يمكن التراجع.")) return;
                const { error } = await supabase.from("projects").delete().eq("id", p.id);
                if (error) return toast(errMsg(error), true);
                toast("تم حذف المشروع"); ctx.reloadProjects();
              }}>حذف</button></td>
            </tr>
          ))}
          {!ctx.projects.length && <tr><td colSpan={3} className="center muted">لا توجد مشاريع</td></tr>}
        </tbody>
      </table></div>
      <p className="muted small">بعد إنشاء المشروع أضف المشرفين من تبويب «الفريق» واربطهم به. المدير التنفيذي والمالك يرون كل المشاريع تلقائيًا.</p>
    </>
  );
}

/* ---------- password ---------- */
function PassModal({ me, onClose }: { me: Profile; onClose: () => void }) {
  const [err, setErr] = useState("");
  return (
    <><h3>تغيير كلمة المرور</h3>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault(); const fd = new FormData(e.currentTarget);
        const { error: e1 } = await supabase.auth.signInWithPassword({ email: toEmail(me.username), password: String(fd.get("o")) });
        if (e1) return setErr("كلمة المرور الحالية غير صحيحة");
        const { error } = await supabase.auth.updateUser({ password: String(fd.get("n")) });
        if (error) return setErr(errMsg(error));
        onClose(); toast("تم تغيير كلمة المرور");
      }}>
        <label>الحالية<input name="o" type="password" required /></label>
        <label>الجديدة (8 أحرف على الأقل)<input name="n" type="password" minLength={8} required /></label>
        <div className="err">{err}</div>
        <div className="row"><button className="pri">حفظ</button><button type="button" onClick={onClose}>إلغاء</button></div>
      </form></>
  );
}

function FavToggle({ on: init, onToggle }: { on: boolean; onToggle: () => void }) {
  const [on, setOn] = useState(init);
  return <button className={"star" + (on ? " on" : "")} onClick={() => { setOn(!on); onToggle(); }}><Star size={17} /> {on ? "في المفضلة" : "أضف للمفضلة"}</button>;
}

/* ---------- favorites ---------- */
function Favorites({ ctx, favs }: { ctx: Ctx; favs: { user_id: string; claim_id: string }[] }) {
  const { me, isMgr, stOf, calc, userName, claimTitle, openClaim } = ctx;
  const [who, setWho] = useState(isMgr ? "" : me.uid);
  const [q, setQ] = useState("");
  /* Only the starred claims are fetched (by id), never the whole project. */
  const [byId, setById] = useState<Map<string, ClaimRow>>(new Map());
  const idsKey = useMemo(() => [...new Set(favs.map((x) => x.claim_id))].sort().join("|"), [favs]);
  useEffect(() => {
    let off = false;
    const ids = idsKey ? idsKey.split("|") : [];
    (async () => {
      const mp = new Map<string, ClaimRow>();
      try {
        for (const part of chunk(ids, 300)) {
          const d = await rpc<ClaimsPage>("claims_page", { p_project: ctx.pid, p_ids: part, p_limit: 300 });
          d.rows.forEach((r) => mp.set(r.id, r));
        }
      } catch (e) { toast(errMsg(e), true); }
      if (!off) { ctx.register([...mp.values()]); setById(mp); }
    })();
    return () => { off = true; };
  }, [idsKey, ctx.pid, ctx.tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const owners = [...new Set(favs.map((f) => f.user_id))];
  const rows = favs.filter((f) => (!who || f.user_id === who) && byId.has(f.claim_id))
    .map((f) => ({ f, c: byId.get(f.claim_id)! }))
    .filter(({ c }) => !q || JSON.stringify(c.data || {}).includes(q) || (c.last_note || "").includes(q));
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>العملاء المفضلون ({rows.length})</h3><span className="grow" />
        <input placeholder="بحث…" value={q} onChange={(e) => setQ(e.target.value)} />
        {isMgr && <select value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">كل الموظفين</option>
          {owners.map((u) => <option key={u} value={u}>{u === me.uid ? "مفضلتي" : userName(u)}</option>)}
        </select>}
      </div>
      <div className="tw"><table className="cards"><thead><tr>
        <th></th><th>المطالبة</th>{isMgr && <th>أضافها</th>}{isMgr && <th>الموظف المسؤول</th>}<th>الحالة</th><th>المتبقي</th><th>موعد المتابعة</th><th>ملاحظة</th><th></th>
      </tr></thead><tbody>
        {rows.map(({ f, c }) => { const st = stOf(c); return (
          <tr key={f.user_id + c.id} className="rowopen" title="انقر مرتين لفتح التفاصيل" onClick={(e) => rowTap(e, c.id, () => openClaim(c.id))}>
            <td data-label="">{f.user_id === me.uid ? <button className="star on" title="إزالة من المفضلة" onClick={() => ctx.toggleFav(c.id)}><Star size={17} /></button> : <Star size={15} className="muted" />}</td>
            <td data-label="المطالبة"><b>{claimTitle(c)}</b></td>
            {isMgr && <td data-label="أضافها">{userName(f.user_id)}</td>}
            {isMgr && <td data-label="الموظف المسؤول">{userName(c.assignee)}</td>}
            <td data-label="الحالة"><span className="pill" style={{ background: st.color }}>{st.name}</span></td>
            <td data-label="المتبقي">{L.money(calc(c).rem)}</td>
            <td data-label="موعد المتابعة">{c.follow_up_date || "—"}</td>
            <td data-label="ملاحظة" className="small">{c.last_note || "—"}</td>
            <td data-label=""><button className="sm" onClick={() => openClaim(c.id)}>فتح</button></td>
          </tr>); })}
        {!rows.length && <tr><td colSpan={9} className="center muted">لا توجد مطالبات مفضلة بعد — اضغط النجمة ☆ بجانب أي مطالبة لإضافتها.</td></tr>}
      </tbody></table></div>
    </div>
  );
}

type CodingReq = { id: string; claim_id: string; requested_by: string; note: string; state: string; requested_at: string; review_note: string };

function CodedView({ ctx, onChanged }: { ctx: Ctx; onChanged: () => void }) {
  const { isMgr, pid, employees, userName } = ctx;
  const [reqs, setReqs] = useState<CodingReq[]>([]);
  const [who, setWho] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [byId, setById] = useState<Map<string, ClaimRow>>(new Map());
  const [codedPage, setCodedPage] = useState<ClaimsPage>({ total: 0, rows: [] });
  const [cp, setCp] = useState(0);
  const load = useCallback(async () => {
    if (!pid) return;
    const { data, error } = await supabase.from("coding_requests").select("id, claim_id, requested_by, note, state, requested_at, review_note")
      .eq("project_id", pid).in("state", ["pending", "rejected"]).order("requested_at", { ascending: false }).limit(300);
    if (error) { ctx.toast(errMsg(error), true); return; }
    setReqs((data || []) as CodingReq[]);
  }, [pid]);
  useEffect(() => { void load(); }, [load, ctx.tick]);
  /* claims behind the requests (fetched by id) */
  const reqKey = [...new Set(reqs.map((r) => r.claim_id))].sort().join("|");
  useEffect(() => {
    if (!pid) return;
    let off = false;
    (async () => {
      const mp = new Map<string, ClaimRow>();
      try {
        for (const part of chunk(reqKey ? reqKey.split("|") : [], 300)) {
          const d = await rpc<ClaimsPage>("claims_page", { p_project: pid, p_ids: part, p_limit: 300 });
          d.rows.forEach((r) => mp.set(r.id, r));
        }
      } catch (e) { toast(errMsg(e), true); }
      if (!off) { ctx.register([...mp.values()]); setById(mp); }
    })();
    return () => { off = true; };
  }, [reqKey, pid, ctx.tick]); // eslint-disable-line react-hooks/exhaustive-deps
  /* the coded clients themselves: paged in the database */
  useEffect(() => {
    if (!pid) return;
    let off = false;
    rpc<ClaimsPage>("claims_page", { p_project: pid, p_coded: true, p_asg: who, p_limit: 50, p_offset: cp * 50 })
      .then((d) => { if (off) return; ctx.register(d.rows); setCodedPage(d); }, (e) => { if (!off) toast(errMsg(e), true); });
    return () => { off = true; };
  }, [pid, who, cp, ctx.tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) { ctx.toast(errMsg(error), true); return; }
    ctx.toast(ok); await load(); onChanged();
  };
  const pending = reqs.filter((r) => r.state === "pending" && byId.has(r.claim_id));
  const rejected = reqs.filter((r) => r.state === "rejected" && byId.has(r.claim_id)).slice(0, 20);
  const coded = codedPage.rows;
  const codedPages = Math.max(1, Math.ceil(codedPage.total / 50));
  return (
    <>
      <div className="card">
        <h3>{isMgr ? "طلبات التكويد بانتظار الموافقة" : "طلباتي بانتظار الموافقة"} ({pending.length})</h3>
        <div className="tw"><table className="cards">
          <thead><tr><th>العميل</th>{isMgr && <th>الموظف</th>}<th>الملاحظة</th><th>التاريخ</th>{isMgr && <th></th>}</tr></thead>
          <tbody>
            {pending.map((r) => { const c = byId.get(r.claim_id)!; return (
              <tr key={r.id}>
                <td data-label="العميل"><a href="#" onClick={(e) => { e.preventDefault(); ctx.openClaim(c.id); }}>{ctx.claimTitle(c)}</a></td>
                {isMgr && <td data-label="الموظف">{userName(r.requested_by)}</td>}
                <td data-label="الملاحظة" style={{ whiteSpace: "normal" }}>{r.note || "—"}</td>
                <td data-label="التاريخ">{new Date(r.requested_at).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" })}</td>
                {isMgr && <td data-label=""><div className="form">
                  <input placeholder="ملاحظة المراجعة" value={notes[r.id] || ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                  <div className="row">
                    <button className="pri sm" disabled={busy} onClick={() => act(() => supabase.rpc("review_coding", { p_id: r.id, p_approve: true, p_note: notes[r.id] || "" }), "تم اعتماد التكويد")}>اعتماد</button>
                    <button className="sm" disabled={busy} onClick={() => act(() => supabase.rpc("review_coding", { p_id: r.id, p_approve: false, p_note: notes[r.id] || "" }), "تم رفض الطلب")}>رفض</button>
                  </div>
                </div></td>}
              </tr>); })}
            {!pending.length && <tr><td colSpan={5} className="center muted">لا توجد طلبات</td></tr>}
          </tbody>
        </table></div>
        {!isMgr && rejected.length > 0 && <p className="muted small">طلبات رُفضت مؤخرًا: {rejected.map((r) => ctx.claimTitle(byId.get(r.claim_id)!) + (r.review_note ? ` (${r.review_note})` : "")).join("، ")}</p>}
      </div>
      <div className="card">
        <div className="row"><h3 className="grow" style={{ margin: 0 }}>العملاء المكودون ({codedPage.total})</h3>
          {isMgr && <select value={who} onChange={(e) => { setWho(e.target.value); setCp(0); }}><option value="">كل الموظفين</option>{employees.map((e) => <option key={e.uid} value={e.uid}>{e.name}</option>)}</select>}
        </div>
        <p className="muted small">العميل المكود يبقى مع موظفه ولا تسحبه إعادة التوزيع. ينتهي تكويده إذا حُذف الموظف أو أُرجعت مطالباته إلى «غير موزّعة».</p>
        <div className="tw"><table className="cards">
          <thead><tr><th>العميل</th>{isMgr && <th>الموظف</th>}<th>الحالة</th><th>المتبقي</th><th>موعد المتابعة</th><th>آخر ملاحظة</th><th></th></tr></thead>
          <tbody>
            {coded.map((c) => { const st = ctx.stOf(c); return (
              <tr key={c.id} className="rowopen" title="انقر مرتين لفتح التفاصيل" onClick={(e) => rowTap(e, c.id, () => ctx.openClaim(c.id))}>
                <td data-label="العميل">{ctx.claimTitle(c)}</td>
                {isMgr && <td data-label="الموظف">{userName(c.assignee)}</td>}
                <td data-label="الحالة"><span className="pill" style={{ background: st.color }}>{st.name}</span></td>
                <td data-label="المتبقي">{L.money(ctx.calc(c).rem)}</td>
                <td data-label="موعد المتابعة">{c.follow_up_date || "—"}</td>
                <td data-label="آخر ملاحظة" style={{ whiteSpace: "normal" }}>{c.last_note || "—"}</td>
                <td data-label=""><div className="row">
                  <button className="sm" onClick={() => ctx.openClaim(c.id)}>فتح</button>
                  {isMgr && <>
                    <select aria-label="نقل إلى" value="" onChange={(e) => { if (e.target.value) void ctx.transfer([c.id], e.target.value); }}>
                      <option value="">نقل إلى…</option>{employees.filter((e) => e.uid !== c.assignee).map((e) => <option key={e.uid} value={e.uid}>{e.name}</option>)}
                    </select>
                    <button className="sm dng" disabled={busy} onClick={() => { if (confirm("إلغاء تكويد هذا العميل؟")) void act(() => supabase.rpc("remove_coding", { p_project: c.project_id, p_claim: c.id }), "تم إلغاء التكويد"); }}>إلغاء التكويد</button>
                  </>}
                </div></td>
              </tr>); })}
            {!coded.length && <tr><td colSpan={7} className="center muted">لا يوجد عملاء مكودون</td></tr>}
          </tbody>
        </table></div>
        {codedPages > 1 && (
          <div className="pager">
            <button disabled={cp === 0} onClick={() => setCp(cp - 1)}>السابق</button>
            <span className="muted">صفحة {cp + 1} من {codedPages}</span>
            <button disabled={cp >= codedPages - 1} onClick={() => setCp(cp + 1)}>التالي</button>
          </div>
        )}
      </div>
    </>
  );
}

function CodingBox({ c, canRequest }: { c: Claim; canRequest: boolean }) {
  const [pending, setPending] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void supabase.from("coding_requests").select("id", { count: "exact", head: true }).eq("project_id", c.project_id).eq("claim_id", c.id).eq("state", "pending")
      .then(({ count }) => setPending((count || 0) > 0));
  }, [c.project_id, c.id]);
  if (c.coded) return <p><span className="pill" style={{ background: "#7c3aed" }}>مكود</span></p>;
  if (pending) return <p className="muted small">طلب التكويد بانتظار موافقة المشرف.</p>;
  if (!canRequest || pending === null) return null;
  return (
    <div className="row" style={{ marginBottom: 10 }}>
      <input placeholder="ملاحظة لطلب التكويد (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button disabled={busy} onClick={async () => {
        setBusy(true);
        const { error } = await supabase.rpc("request_coding", { p_project: c.project_id, p_claim: c.id, p_note: note });
        setBusy(false);
        if (error) { toast(errMsg(error), true); return; }
        setPending(true); toast("تم إرسال طلب التكويد للمشرف");
      }}>طلب تكويد</button>
    </div>
  );
}
