import { useEffect, useMemo, useState, type ReactNode } from "react";
import * as XLSX from "xlsx";
import * as L from "@/lib/mutabee";
import { PAYMENT_STATUSES } from "@/lib/payments";
import { PERIODS, periodRange, type Period } from "@/lib/report-period";
import { errMsg, rpc, useRpc, type Profile, type Project } from "./data";

/* ---------- types of the report functions (see drizzle/migrations/0001) ---------- */
type Overview = { claims: number; required: number; remaining: number; closed: number; overdue: number; overdue_amount: number; collected: number; collected_total: number; pending: number; waived: number };
type Month = { month: string; collected: number; payments: number };
type EmpRow = { uid: string | null; name: string; claims: number; required: number; collected: number; remaining: number; closed: number; overdue: number; pct: number };
type ProjRow = { project_id: string; name: string; claims: number; employees: number; required: number; collected: number; remaining: number; closed: number; overdue: number; pct: number };
type StatusRow = { status_id: string; name: string; color: string; claims: number; remaining: number };
type OverdueRow = { project_id: string; project_name: string; claim_id: string; data: Record<string, string>; assignee: string | null; assignee_name: string; remaining: number; follow_up_date: string; days_late: number; status: string; total_count: number };

const money = L.money;
const pad = (n: number) => String(n).padStart(2, "0");

const monthLabel = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { month: "short", year: "2-digit", timeZone: "UTC" });
const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} مليون` : n >= 1e4 ? `${Math.round(n / 1e3)} ألف` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} ألف` : money(n));
const Kpi = ({ label, value, sub, bad }: { label: string; value: ReactNode; sub?: ReactNode; bad?: boolean }) => (
  <div className="stat"><span className="muted">{label}</span><b style={bad ? { color: "var(--destructive)" } : undefined}>{value}</b>{sub != null && <span className="muted small">{sub}</span>}</div>
);
const Err = ({ m }: { m?: string }) => (m ? <p className="err" role="alert">{m}</p> : null);
const Loading = () => <p className="center muted small">جارٍ التحميل…</p>;

function MonthlyChart({ rows }: { rows: Month[] }) {
  const max = Math.max(1, ...rows.map((r) => r.collected));
  return (
    <div className="mbars" role="img" aria-label="التحصيل الشهري">
      {rows.map((r) => (
        <div key={r.month} className="mbar" title={`${monthLabel(r.month)}: ${money(r.collected)} (${r.payments} سداد)`}>
          <span className="mv">{r.collected ? short(r.collected) : "—"}</span>
          <div className="mcol"><i style={{ height: `${(r.collected / max) * 100}%` }} /></div>
          <span className="ml">{monthLabel(r.month)}</span>
        </div>
      ))}
    </div>
  );
}

const statusName = (project: Project | undefined, id: string) =>
  [...(project?.statuses || []), ...L.DEFAULT_STATUSES, ...PAYMENT_STATUSES].find((s) => s.id === id)?.name || id;
const claimTitle = (project: Project | undefined, r: OverdueRow) => {
  const cols = project?.display_cols?.length ? project.display_cols : (project?.columns || []).slice(0, 4);
  return cols.slice(0, 3).map((k) => r.data?.[k]).filter(Boolean).join(" · ") || r.claim_id.slice(0, 8);
};

/* ====================================================================== */
/* The report itself: KPIs, monthly chart, employees, statuses, overdue    */
/* ====================================================================== */
type BodyProps = {
  project: string | null; employee: string | null; from: string | null; to: string | null;
  isMgr: boolean; projects: Project[]; users: Profile[]; pid: string | null; label: string;
  onPickEmployee?: (uid: string) => void; openClaimById: (projectId: string, id: string) => void; goProject: (id: string) => void;
  toast: (m: string, bad?: boolean) => void;
};

function ReportBody(p: BodyProps) {
  const { project, employee, from, to, isMgr } = p;
  const [months, setMonths] = useState(6);
  const [stEmp, setStEmp] = useState("");
  const [page, setPage] = useState(0);
  const per = 15;
  useEffect(() => { setPage(0); setStEmp(""); }, [project, employee]);

  const ov = useRpc<Overview[]>("report_overview", { p_project: project, p_employee: employee, p_from: from, p_to: to });
  const mo = useRpc<Month[]>("report_monthly", { p_project: project, p_employee: employee, p_months: months });
  const emps = useRpc<EmpRow[]>("report_employees", { p_project: project, p_from: from, p_to: to }, isMgr && !employee);
  const stEffective = employee || stEmp || null;
  const dist = useRpc<StatusRow[]>("report_status_dist", { p_project: project, p_employee: stEffective });
  const od = useRpc<OverdueRow[]>("report_overdue", { p_project: project, p_employee: employee, p_limit: per, p_offset: page * per });

  const o = ov.data?.[0];
  const pct = o && o.required > 0 ? Math.round((o.collected_total / o.required) * 1000) / 10 : 0;
  const totalClaims = (dist.data || []).reduce((a, r) => a + r.claims, 0);
  const empOptions = p.users.filter((u) => u.role === "employee" && (!project || u.projectIds.includes(project)));
  const odTotal = od.data?.[0]?.total_count ?? 0;
  const pages = Math.max(1, Math.ceil(odTotal / per));

  async function exportXlsx() {
    try {
      const all = await rpc<OverdueRow[]>("report_overdue", { p_project: project, p_employee: employee, p_limit: 500, p_offset: 0 });
      const wb = XLSX.utils.book_new();
      const add = (name: string, rows: Record<string, unknown>[]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ "—": "لا توجد بيانات" }]), name);
      add("الملخص", o ? [{
        "النطاق": p.label, "الفترة": from || to ? `${from || "…"} → ${to || "…"}` : "كل الفترات",
        "المطالبات": o.claims, "المطلوب": o.required, "المحصّل في الفترة": o.collected, "إجمالي المحصّل": o.collected_total,
        "بانتظار الاعتماد": o.pending, "المتبقي": o.remaining, "نسبة التحصيل %": pct, "متأخرة": o.overdue, "مبلغ المتأخر": o.overdue_amount, "مغلقة": o.closed, "خصومات": o.waived,
      }] : []);
      add("شهري", (mo.data || []).map((r) => ({ "الشهر": r.month.slice(0, 7), "المحصّل": r.collected, "عدد السدادات": r.payments })));
      if (emps.data) add("الموظفون", emps.data.map((r) => ({ "الموظف": r.name, "المطالبات": r.claims, "المطلوب": r.required, "المحصّل": r.collected, "المتبقي": r.remaining, "متأخرة": r.overdue, "مغلقة": r.closed, "النسبة %": r.pct })));
      add("الحالات", (dist.data || []).map((r) => ({ "الحالة": r.name, "المطالبات": r.claims, "المتبقي": r.remaining })));
      add("المتأخرة", all.map((r) => ({ "المشروع": r.project_name, "المطالبة": claimTitle(p.projects.find((x) => x.id === r.project_id), r), "الموظف": r.assignee_name, "الموعد": r.follow_up_date, "أيام التأخير": r.days_late, "المتبقي": r.remaining, "الحالة": statusName(p.projects.find((x) => x.id === r.project_id), r.status) })));
      wb.Workbook = { Views: [{ RTL: true }] };
      XLSX.writeFile(wb, `تقرير-${p.label}.xlsx`);
    } catch (e) { p.toast(errMsg(e), true); }
  }

  return (
    <>
      <Err m={ov.error || mo.error || dist.error || od.error || emps.error} />
      <div className="stats">
        <Kpi label="المطلوب" value={o ? money(o.required) : "…"} sub={o ? `${o.claims} مطالبة` : undefined} />
        <Kpi label="المحصّل (معتمد)" value={o ? money(o.collected) : "…"} sub={o ? `بانتظار الاعتماد: ${money(o.pending)} · الإجمالي: ${money(o.collected_total)}` : undefined} />
        <Kpi label="المتبقي" value={o ? money(o.remaining) : "…"} sub={o && o.waived ? `خصومات: ${money(o.waived)}` : undefined} />
        <Kpi label="نسبة التحصيل" value={o ? `${pct}%` : "…"} sub={o ? `مغلقة: ${o.closed}` : undefined} />
        <Kpi label="متأخرة" value={o ? o.overdue : "…"} sub={o ? money(o.overdue_amount) : undefined} bad={!!o && o.overdue > 0} />
      </div>

      <div className="card">
        <div className="row">
          <h3 style={{ margin: 0 }}>التحصيل الشهري</h3><span className="grow" />
          {[6, 12].map((n) => <button key={n} className={"sm" + (months === n ? " pri" : "")} onClick={() => setMonths(n)}>{n} أشهر</button>)}
          <button className="sm" onClick={() => void exportXlsx()}>تصدير إكسل</button>
        </div>
        <p className="muted small" style={{ margin: "4px 0 8px" }}>السدادات المعتمدة فقط، حسب تاريخ السداد.</p>
        {mo.data ? <MonthlyChart rows={mo.data} /> : <Loading />}
      </div>

      {isMgr && !employee && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>أداء الموظفين</h3>
          {emps.data ? (
            <div className="tw"><table className="cards">
              <thead><tr><th>الموظف</th><th>المطالبات</th><th>المطلوب</th><th>المحصّل</th><th>المتبقي</th><th>متأخرة</th><th>مغلقة</th><th>النسبة</th></tr></thead>
              <tbody>
                {emps.data.map((r) => (
                  <tr key={r.uid || "_"} className={r.uid && p.onPickEmployee ? "rowopen" : ""} onClick={() => r.uid && p.onPickEmployee?.(r.uid)} title={r.uid && p.onPickEmployee ? "اضغط لعرض تقرير الموظف" : undefined}>
                    <td data-label="الموظف"><b>{r.name}</b></td><td data-label="المطالبات">{r.claims}</td><td data-label="المطلوب">{money(r.required)}</td>
                    <td data-label="المحصّل">{money(r.collected)}</td><td data-label="المتبقي">{money(r.remaining)}</td>
                    <td data-label="متأخرة" className={r.overdue ? "late" : ""}>{r.overdue}</td><td data-label="مغلقة">{r.closed}</td>
                    <td data-label="النسبة"><div className="row"><div className="bar grow"><i style={{ width: `${Math.min(100, r.pct)}%` }} /></div><b>{r.pct}%</b></div></td>
                  </tr>
                ))}
                {!emps.data.length && <tr><td colSpan={8} className="center muted">لا يوجد موظفون</td></tr>}
              </tbody>
            </table></div>
          ) : <Loading />}
        </div>
      )}

      <div className="card">
        <div className="row">
          <h3 style={{ margin: 0 }}>توزيع الحالات</h3><span className="grow" />
          {isMgr && !employee && (
            <select value={stEmp} onChange={(e) => setStEmp(e.target.value)} aria-label="الموظف">
              <option value="">كل الموظفين</option>{empOptions.map((u) => <option key={u.uid} value={u.uid}>{u.name}</option>)}
            </select>
          )}
        </div>
        {dist.data ? (
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {dist.data.map((r) => (
              <div key={r.status_id} className="row" style={{ flexWrap: "nowrap" }}>
                <span className="pill" style={{ background: r.color, minWidth: 96, textAlign: "center" }}>{r.name}</span>
                <div className="bar grow"><i style={{ width: `${totalClaims ? (r.claims / totalClaims) * 100 : 0}%`, background: r.color }} /></div>
                <b style={{ minWidth: 36 }}>{r.claims}</b><span className="muted small" style={{ minWidth: 110 }}>متبقي {money(r.remaining)}</span>
              </div>
            ))}
          </div>
        ) : <Loading />}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>المتابعات المتأخرة {od.data ? `(${odTotal})` : ""}</h3>
        {od.data ? (
          <>
            <div className="tw"><table className="cards">
              <thead><tr><th>الموعد</th><th>المطالبة</th><th>المشروع</th>{isMgr && <th>الموظف</th>}<th>المتبقي</th><th>الحالة</th><th></th></tr></thead>
              <tbody>
                {od.data.map((r) => {
                  const pr = p.projects.find((x) => x.id === r.project_id);
                  return (
                    <tr key={r.project_id + r.claim_id}>
                      <td data-label="الموعد" className="late">{r.follow_up_date} (متأخرة {r.days_late} يوم)</td>
                      <td data-label="المطالبة">{claimTitle(pr, r)}</td><td data-label="المشروع">{r.project_name}</td>
                      {isMgr && <td data-label="الموظف">{r.assignee_name}</td>}
                      <td data-label="المتبقي">{money(r.remaining)}</td><td data-label="الحالة">{statusName(pr, r.status)}</td>
                      <td data-label="">{r.project_id === p.pid
                        ? <button className="sm" onClick={() => p.openClaimById(r.project_id, r.claim_id)}>فتح</button>
                        : <button className="sm" onClick={() => p.goProject(r.project_id)}>انتقل للمشروع</button>}</td>
                    </tr>
                  );
                })}
                {!od.data.length && <tr><td colSpan={7} className="center muted">لا توجد متابعات متأخرة 👍</td></tr>}
              </tbody>
            </table></div>
            {pages > 1 && (
              <div className="pager">
                <button disabled={page === 0} onClick={() => setPage(page - 1)}>السابق</button>
                <span className="muted">صفحة {page + 1} من {pages}</span>
                <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>التالي</button>
              </div>
            )}
          </>
        ) : <Loading />}
      </div>
    </>
  );
}

/* ====================================================================== */
/* Page: sub-tabs overview / projects / employees (+ «تقريري» for staff)   */
/* ====================================================================== */
export function Reports({ me, isMgr, isTop, projects, users, pid, setPid, openClaimById, toast }: {
  me: Profile; isMgr: boolean; isTop: boolean; projects: Project[]; users: Profile[]; pid: string | null; setPid: (id: string) => void;
  openClaimById: (projectId: string, id: string) => void; toast: (m: string, bad?: boolean) => void;
}) {
  type Tab = "overview" | "projects" | "employees";
  const [tab, setTab] = useState<Tab>("overview");
  const [proj, setProj] = useState<string>(isTop ? "" : pid || "");   // "" = كل المشاريع المسموحة
  const [period, setPeriod] = useState<Period>("month");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [emp, setEmp] = useState("");
  const [detailProject, setDetailProject] = useState<string | null>(null);
  const [detailEmp, setDetailEmp] = useState<string | null>(null);
  const range = useMemo(() => periodRange(period, custom), [period, custom]);
  const projName = (id: string) => projects.find((x) => x.id === id)?.name || "مشروع";
  const empOptions = users.filter((u) => u.role === "employee" && (!proj || u.projectIds.includes(proj)));

  const common = { ...range, isMgr, projects, users, pid, openClaimById, toast, goProject: setPid };

  const filters = (
    <div className="card">
      <div className="row">
        {projects.length > 1 && (
          <select value={proj} onChange={(e) => { setProj(e.target.value); setEmp(""); }} aria-label="المشروع">
            <option value="">كل المشاريع</option>{projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        )}
        <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="الفترة">
          {PERIODS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        {period === "custom" && (
          <>
            <label className="small">من <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
            <label className="small">إلى <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label>
          </>
        )}
        {isMgr && tab === "overview" && (
          <select value={emp} onChange={(e) => setEmp(e.target.value)} aria-label="الموظف">
            <option value="">كل الموظفين</option>{empOptions.map((u) => <option key={u.uid} value={u.uid}>{u.name}</option>)}
          </select>
        )}
      </div>
    </div>
  );

  /* employee (not a manager): his own numbers only */
  if (!isMgr) {
    return (
      <>
        <h3 style={{ marginTop: 0 }}>تقريري</h3>
        {filters}
        <ReportBody {...common} project={proj || null} employee={me.uid} label={`${me.name}`} />
      </>
    );
  }

  const tabBtn = (k: Tab, t: string) => <button key={k} className={"sm" + (tab === k ? " pri" : "")} onClick={() => { setTab(k); setDetailProject(null); setDetailEmp(null); }}>{t}</button>;
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>{tabBtn("overview", "نظرة عامة")}{tabBtn("projects", "المشاريع")}{tabBtn("employees", "الموظفون")}</div>
      {filters}
      {tab === "overview" && <ReportBody {...common} project={proj || null} employee={emp || null} label={proj ? projName(proj) : "كل المشاريع"} onPickEmployee={(u) => { setDetailEmp(u); setTab("employees"); }} />}
      {tab === "projects" && (detailProject
        ? <>
            <div className="row" style={{ marginBottom: 10 }}><button className="sm" onClick={() => setDetailProject(null)}>← كل المشاريع</button><h3 style={{ margin: 0 }}>{projName(detailProject)}</h3></div>
            <ReportBody {...common} project={detailProject} employee={null} label={projName(detailProject)} onPickEmployee={(u) => { setProj(detailProject); setDetailEmp(u); setTab("employees"); }} />
          </>
        : <ProjectsTable from={range.from} to={range.to} onPick={setDetailProject} />)}
      {tab === "employees" && (detailEmp
        ? <>
            <div className="row" style={{ marginBottom: 10 }}><button className="sm" onClick={() => setDetailEmp(null)}>← كل الموظفين</button><h3 style={{ margin: 0 }}>{users.find((u) => u.uid === detailEmp)?.name || "موظف"}</h3></div>
            <ReportBody {...common} project={proj || null} employee={detailEmp} label={users.find((u) => u.uid === detailEmp)?.name || "موظف"} />
          </>
        : <EmployeesTable project={proj || null} from={range.from} to={range.to} onPick={setDetailEmp} />)}
    </>
  );
}

function ProjectsTable({ from, to, onPick }: { from: string | null; to: string | null; onPick: (id: string) => void }) {
  const r = useRpc<ProjRow[]>("report_projects", { p_from: from, p_to: to });
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>مقارنة المشاريع</h3>
      <Err m={r.error} />
      {r.data ? (
        <div className="tw"><table className="cards">
          <thead><tr><th>المشروع</th><th>الموظفون</th><th>المطالبات</th><th>المطلوب</th><th>المحصّل</th><th>المتبقي</th><th>متأخرة</th><th>النسبة</th></tr></thead>
          <tbody>
            {r.data.map((x) => (
              <tr key={x.project_id} className="rowopen" onClick={() => onPick(x.project_id)} title="اضغط لعرض تقرير المشروع">
                <td data-label="المشروع"><b>{x.name}</b></td><td data-label="الموظفون">{x.employees}</td><td data-label="المطالبات">{x.claims}</td>
                <td data-label="المطلوب">{money(x.required)}</td><td data-label="المحصّل">{money(x.collected)}</td><td data-label="المتبقي">{money(x.remaining)}</td>
                <td data-label="متأخرة" className={x.overdue ? "late" : ""}>{x.overdue}</td>
                <td data-label="النسبة"><div className="row"><div className="bar grow"><i style={{ width: `${Math.min(100, x.pct)}%` }} /></div><b>{x.pct}%</b></div></td>
              </tr>
            ))}
            {!r.data.length && <tr><td colSpan={8} className="center muted">لا توجد مشاريع</td></tr>}
          </tbody>
        </table></div>
      ) : <Loading />}
    </div>
  );
}

function EmployeesTable({ project, from, to, onPick }: { project: string | null; from: string | null; to: string | null; onPick: (uid: string) => void }) {
  const r = useRpc<EmpRow[]>("report_employees", { p_project: project, p_from: from, p_to: to });
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>أداء الموظفين</h3>
      <Err m={r.error} />
      {r.data ? (
        <div className="tw"><table className="cards">
          <thead><tr><th>الموظف</th><th>المطالبات</th><th>المطلوب</th><th>المحصّل</th><th>المتبقي</th><th>متأخرة</th><th>مغلقة</th><th>النسبة</th></tr></thead>
          <tbody>
            {r.data.map((x) => (
              <tr key={x.uid || "_"} className={x.uid ? "rowopen" : ""} onClick={() => x.uid && onPick(x.uid)} title={x.uid ? "اضغط لعرض تقرير الموظف" : undefined}>
                <td data-label="الموظف"><b>{x.name}</b></td><td data-label="المطالبات">{x.claims}</td><td data-label="المطلوب">{money(x.required)}</td>
                <td data-label="المحصّل">{money(x.collected)}</td><td data-label="المتبقي">{money(x.remaining)}</td>
                <td data-label="متأخرة" className={x.overdue ? "late" : ""}>{x.overdue}</td><td data-label="مغلقة">{x.closed}</td>
                <td data-label="النسبة"><div className="row"><div className="bar grow"><i style={{ width: `${Math.min(100, x.pct)}%` }} /></div><b>{x.pct}%</b></div></td>
              </tr>
            ))}
            {!r.data.length && <tr><td colSpan={8} className="center muted">لا يوجد موظفون</td></tr>}
          </tbody>
        </table></div>
      ) : <Loading />}
    </div>
  );
}
