-- 0001 — التقارير + نقل الحسابات من المتصفح إلى قاعدة البيانات.
-- يُشغَّل مرة واحدة في Supabase ‹ SQL Editor› بعد 0000. إعادة تشغيله لا تضرّ (create or replace).
-- كل الدوال "security invoker": أي أن سياسات RLS الحالية هي التي تحدد ما يراه كل مستخدم
-- (المالك/المدير: كل المشاريع، المشرف: مشاريعه، الموظف: مطالباته فقط). لا صلاحيات جديدة.

begin;

/* ------------------------------------------------------------------ */
/* أدوات مساعدة                                                         */
/* ------------------------------------------------------------------ */
create or replace function public.riyadh_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date $$;

/* الحالات الفعلية للمشروع: المخزّنة + الافتراضية الناقصة + الفرعية المدمجة (نفس منطق الواجهة السابق) */
create or replace function public.project_statuses(p_project uuid default null)
returns table(project_id uuid, id text, name text, color text, closed boolean, paid boolean, parent text, ord int)
language sql stable set search_path = public as $$
  with prj as (select p.id as pid, p.statuses from public.projects p where p_project is null or p.id = p_project),
  stored as (
    select p.pid, s->>'id' as sid, coalesce(s->>'name', s->>'id') as sname, coalesce(s->>'color', '#64748b') as scolor,
           coalesce((s->>'closed')::boolean, false) as sclosed, coalesce((s->>'paid')::boolean, false) as spaid,
           nullif(s->>'parent', '') as sparent, t.ord::int as sord
    from prj p
    cross join lateral jsonb_array_elements(case when jsonb_typeof(p.statuses) = 'array' then p.statuses else '[]'::jsonb end) with ordinality as t(s, ord)
    where s->>'id' is not null
  ),
  defs(did, dname, dcolor, dclosed, dpaid, dparent, dord) as (values
    ('s_new',       'جديد',         '#64748b', false, false, null::text, 1001),
    ('s_contacted', 'تم التواصل',   '#2563eb', false, false, null::text, 1002),
    ('s_promise',   'وعد بالسداد',  '#d97706', false, false, null::text, 1003),
    ('s_refused',   'رفض',          '#dc2626', false, false, null::text, 1004),
    ('s_noreply',   'لا يرد',       '#8b5cf6', false, false, null::text, 1005),
    ('s_paid',      'تم السداد',    '#16a34a', true,  true,  null::text, 1006),
    ('s_partial',   'سداد جزئي',    '#0891b2', false, false, 's_paid',   1007),
    ('s_scheduled', 'سداد جدولة',   '#0d9488', false, false, 's_paid',   1008),
    ('s_discount',  'سداد بالخصم',  '#ca8a04', true,  false, 's_paid',   1009)
  )
  select s.pid, s.sid, s.sname, s.scolor, s.sclosed, s.spaid,
         case when s.sid in ('s_partial', 's_scheduled', 's_discount') then 's_paid' else s.sparent end, s.sord
  from stored s
  union all
  select p.pid, d.did, d.dname, d.dcolor, d.dclosed, d.dpaid, d.dparent, d.dord
  from prj p cross join defs d
  where not exists (select 1 from stored x where x.pid = p.pid and x.sid = d.did)
$$;

/* صف المطالبة + القيم المحسوبة (المتبقي / مغلقة / الحالة الرئيسية). هذا هو المصدر الوحيد لهذه الحسابات. */
do $$ begin
  if not exists (select 1 from pg_type where typname = 'claim_row' and typnamespace = 'public'::regnamespace) then
    create type public.claim_row as (
      project_id uuid, id text, data jsonb, amount numeric, paid numeric, approved_paid numeric, settlement_amount numeric,
      assignee uuid, status text, note text, last_note text, follow_up_date text, seq bigint, batch_id text, coded boolean,
      updated_at timestamptz, updated_by uuid, updated_by_name text, rem numeric, closed boolean, main_status text
    );
  end if;
end $$;

/* المتبقي = max( (مبلغ التسوية أو المبلغ) − المعتمد , 0 ).
   مغلقة: إن كانت الحالة (أو أصلها) حالة سداد ⇐ المتبقي = 0، وإلا فإعداد «مغلقة» للحالة. */
create or replace function public.claims_calc(p_project uuid default null)
returns setof public.claim_row
language sql stable set search_path = public as $$
  with st as (select * from public.project_statuses(p_project)),
  fm as (select distinct on (s.project_id) s.project_id, s.id from st s where s.parent is null order by s.project_id, s.ord)
  select c.project_id, c.id, c.data, c.amount, c.paid, c.approved_paid, c.settlement_amount,
         c.assignee, c.status, c.note, c.last_note, c.follow_up_date, c.seq, c.batch_id, c.coded,
         c.updated_at, c.updated_by, c.updated_by_name,
         t.rem,
         case when coalesce(base.paid, real.paid, false) then t.rem = 0 else coalesce(real.closed, false) end,
         coalesce(base.id, real.id)
  from public.claims c
  left join st r0   on r0.project_id = c.project_id and r0.id = c.status
  left join fm      on fm.project_id = c.project_id and r0.id is null
  left join st real on real.project_id = c.project_id and real.id = coalesce(r0.id, fm.id)
  left join st base on base.project_id = c.project_id and base.id = real.parent
  cross join lateral (
    select greatest(coalesce(c.settlement_amount, greatest(c.amount, 0)) - greatest(c.approved_paid, 0), 0) as rem
  ) t
  where p_project is null or c.project_id = p_project
$$;

/* ------------------------------------------------------------------ */
/* جلب المطالبات بصفحات (بحث + فلاتر من السيرفر)                         */
/* ------------------------------------------------------------------ */
create or replace function public.claims_filtered(
  p_project uuid, p_q text default '', p_status text default '', p_asg text default '', p_fu text default '',
  p_coded boolean default null, p_fav boolean default false, p_ids text[] default null)
returns setof public.claim_row
language sql stable set search_path = public as $$
  select * from public.claims_calc(p_project) c
  where (coalesce(p_status, '') = '' or c.main_status = p_status)
    and case coalesce(p_asg, '')
          when '' then true
          when '_' then c.assignee is null
          else c.assignee::text = p_asg end
    and case coalesce(p_fu, '')
          when 'today' then c.follow_up_date = to_char(public.riyadh_today(), 'YYYY-MM-DD')
          when 'over'  then c.follow_up_date ~ '^\d{4}-\d{2}-\d{2}$' and c.follow_up_date < to_char(public.riyadh_today(), 'YYYY-MM-DD') and not c.closed
          when 'due'   then c.follow_up_date ~ '^\d{4}-\d{2}-\d{2}$' and c.follow_up_date <= to_char(public.riyadh_today(), 'YYYY-MM-DD') and not c.closed
          when 'none'  then c.follow_up_date = ''
          else true end
    and (p_coded is null or c.coded = p_coded)
    and (not coalesce(p_fav, false) or exists (
          select 1 from public.claim_favorites f where f.user_id = auth.uid() and f.project_id = c.project_id and f.claim_id = c.id))
    and (p_ids is null or c.id = any(p_ids))
    and (coalesce(btrim(p_q), '') = '' or
         lower(jsonb_path_query_array(c.data, '$.*')::text || ' ' || c.last_note)
           like '%' || lower(replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_')) || '%' escape '\')
$$;

create or replace function public.claims_page(
  p_project uuid, p_q text default '', p_status text default '', p_asg text default '', p_fu text default '',
  p_coded boolean default null, p_fav boolean default false, p_ids text[] default null,
  p_limit int default 50, p_offset int default 0)
returns jsonb
language sql stable set search_path = public as $$
  with f as (select * from public.claims_filtered(p_project, p_q, p_status, p_asg, p_fu, p_coded, p_fav, p_ids)),
  pg as (select * from f order by f.seq, f.id limit least(greatest(coalesce(p_limit, 50), 1), 1000) offset greatest(coalesce(p_offset, 0), 0))
  select jsonb_build_object(
    'total', (select count(*) from f),
    'rows',  coalesce((select jsonb_agg(to_jsonb(pg) order by pg.seq, pg.id) from pg), '[]'::jsonb))
$$;

/* كل معرّفات النتائج (لزر «تحديد كل النتائج») */
create or replace function public.claims_ids(
  p_project uuid, p_q text default '', p_status text default '', p_asg text default '', p_fu text default '',
  p_coded boolean default null, p_fav boolean default false)
returns text[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(f.id order by f.seq, f.id), '{}'::text[])
  from public.claims_filtered(p_project, p_q, p_status, p_asg, p_fu, p_coded, p_fav, null) f
$$;

/* المتابعات المستحقة (اليوم + المتأخرة) مع حالة «شُوهدت» */
create or replace function public.claims_due(p_project uuid, p_asg text default '', p_limit int default 200, p_offset int default 0)
returns jsonb
language sql stable set search_path = public as $$
  with f as (
    select d.*, exists (
      select 1 from public.reminder_seen s
      where s.project_id = d.project_id and s.claim_id = d.id and s.due_date = d.follow_up_date
        and (s.user_id = auth.uid() or s.user_id = d.assignee)) as seen
    from public.claims_filtered(p_project, '', '', p_asg, 'due', null, false, null) d
  ),
  pg as (select * from f order by f.follow_up_date, f.id limit least(greatest(coalesce(p_limit, 200), 1), 1000) offset greatest(coalesce(p_offset, 0), 0))
  select jsonb_build_object(
    'total',  (select count(*) from f),
    'unseen', (select count(*) from f where not f.seen),
    'rows',   coalesce((select jsonb_agg(to_jsonb(pg) order by pg.follow_up_date, pg.id) from pg), '[]'::jsonb))
$$;

create or replace function public.due_unseen_count(p_project uuid) returns bigint
language sql stable set search_path = public as $$
  select count(*) from public.claims_filtered(p_project, '', '', '', 'due', null, false, null) d
  where not exists (
    select 1 from public.reminder_seen s
    where s.project_id = d.project_id and s.claim_id = d.id and s.due_date = d.follow_up_date
      and (s.user_id = auth.uid() or s.user_id = d.assignee))
$$;

/* إحصاءات صفحة «الرفع والتوزيع»: غير الموزّع، أحمال الموظفين، الملفات */
create or replace function public.project_stats(p_project uuid) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'total',            (select count(*) from public.claims c where c.project_id = p_project),
    'unassigned_count', (select count(*) from public.claims c where c.project_id = p_project and c.assignee is null),
    'unassigned_sum',   (select coalesce(sum(greatest(c.amount, 0)), 0) from public.claims c where c.project_id = p_project and c.assignee is null),
    'movable_count',    (select count(*) from public.claims c where c.project_id = p_project and not c.coded),
    'loads', coalesce((select jsonb_agg(jsonb_build_object('uid', x.assignee, 'count', x.n, 'sum', x.s))
                       from (select c.assignee, count(*) n, coalesce(sum(greatest(c.amount, 0)), 0) s
                             from public.claims c where c.project_id = p_project and c.assignee is not null group by c.assignee) x), '[]'::jsonb),
    'batches', coalesce((select jsonb_agg(jsonb_build_object('id', x.batch_id, 'count', x.n, 'sum', x.s) order by x.batch_id)
                         from (select c.batch_id, count(*) n, coalesce(sum(greatest(c.amount, 0)), 0) s
                               from public.claims c where c.project_id = p_project and c.batch_id is not null group by c.batch_id) x), '[]'::jsonb))
$$;

/* هل توجد مطالبات بإحدى هذه الحالات؟ (قبل حذف حالة من الإعدادات) */
create or replace function public.status_in_use(p_project uuid, p_ids text[]) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from public.claims c where c.project_id = p_project and c.status = any(p_ids))
$$;

/* ------------------------------------------------------------------ */
/* التقارير                                                              */
/* ------------------------------------------------------------------ */
-- التحصيل = السدادات المعتمدة فقط، موزّعة حسب تاريخ السداد (paid_on).
-- المطلوب والمتبقي والمتأخر لقطة اللحظة؛ المحصّل يتأثر بالفترة (من/إلى) إن حُدّدت.

create or replace function public.report_overview(
  p_project uuid default null, p_employee uuid default null, p_from date default null, p_to date default null)
returns table(claims bigint, required numeric, remaining numeric, closed bigint, overdue bigint, overdue_amount numeric,
              collected numeric, collected_total numeric, pending numeric, waived numeric)
language sql stable set search_path = public as $$
  with c as (select * from public.claims_calc(p_project) x where p_employee is null or x.assignee = p_employee),
  agg as (
    select count(*) as n,
           coalesce(sum(greatest(amount, 0)), 0) as req,
           coalesce(sum(rem), 0) as rem,
           count(*) filter (where closed) as cl,
           count(*) filter (where late) as od,
           coalesce(sum(rem) filter (where late), 0) as odamt,
           coalesce(sum(greatest(amount - settlement_amount, 0)) filter (where settlement_amount is not null), 0) as waived
    from (select c.*, (c.follow_up_date ~ '^\d{4}-\d{2}-\d{2}$' and c.follow_up_date < to_char(public.riyadh_today(), 'YYYY-MM-DD') and not c.closed) as late from c) c
  ),
  pay as (
    select coalesce(sum(p.amount) filter (where p.state = 'approved' and (p_from is null or p.paid_on >= p_from) and (p_to is null or p.paid_on <= p_to)), 0) as col,
           coalesce(sum(p.amount) filter (where p.state = 'approved'), 0) as tot,
           coalesce(sum(p.amount) filter (where p.state = 'pending'  and (p_from is null or p.paid_on >= p_from) and (p_to is null or p.paid_on <= p_to)), 0) as pend
    from public.claim_payments p join c on c.project_id = p.project_id and c.id = p.claim_id
  )
  select agg.n, agg.req, agg.rem, agg.cl, agg.od, agg.odamt, pay.col, pay.tot, pay.pend, agg.waived from agg, pay
$$;

create or replace function public.report_monthly(p_project uuid default null, p_employee uuid default null, p_months int default 6)
returns table(month date, collected numeric, payments bigint)
language sql stable set search_path = public as $$
  with n as (select least(greatest(coalesce(p_months, 6), 1), 36) as k),
  m as (
    select (date_trunc('month', public.riyadh_today())::date - (g * interval '1 month'))::date as month
    from n, generate_series(0, (select k from n) - 1) g
  ),
  pay as (
    select date_trunc('month', p.paid_on)::date as month, p.amount, p.id
    from public.claim_payments p join public.claims c on c.project_id = p.project_id and c.id = p.claim_id
    where p.state = 'approved' and (p_project is null or p.project_id = p_project) and (p_employee is null or c.assignee = p_employee)
  )
  select m.month, coalesce(sum(pay.amount), 0), count(pay.id)
  from m left join pay on pay.month = m.month
  group by m.month order by m.month
$$;

create or replace function public.report_employees(p_project uuid default null, p_from date default null, p_to date default null)
returns table(uid uuid, name text, claims bigint, required numeric, collected numeric, remaining numeric, closed bigint, overdue bigint, pct numeric)
language sql stable set search_path = public as $$
  with c as (select * from public.claims_calc(p_project)),
  agg as (
    select assignee, count(*) as n, coalesce(sum(greatest(amount, 0)), 0) as req, coalesce(sum(rem), 0) as rem,
           count(*) filter (where closed) as cl,
           count(*) filter (where follow_up_date ~ '^\d{4}-\d{2}-\d{2}$' and follow_up_date < to_char(public.riyadh_today(), 'YYYY-MM-DD') and not closed) as od
    from c group by assignee
  ),
  pay as (
    select cl.assignee, coalesce(sum(p.amount), 0) as col
    from public.claim_payments p join public.claims cl on cl.project_id = p.project_id and cl.id = p.claim_id
    where p.state = 'approved' and (p_project is null or p.project_id = p_project)
      and (p_from is null or p.paid_on >= p_from) and (p_to is null or p.paid_on <= p_to)
    group by cl.assignee
  ),
  emps as (
    select pr.id from public.profiles pr join public.user_roles r on r.user_id = pr.id
    where r.role = 'employee' and pr.active and p_project is not null and p_project = any(pr.project_ids)
  ),
  keys as (select assignee as k from agg union select id from emps)
  select k.k,
         case when k.k is null then 'غير موزّعة' else coalesce(pr.name, 'موظف محذوف') end,
         coalesce(a.n, 0), coalesce(a.req, 0), coalesce(py.col, 0), coalesce(a.rem, 0), coalesce(a.cl, 0), coalesce(a.od, 0),
         case when coalesce(a.req, 0) > 0 then round(coalesce(py.col, 0) / a.req * 100, 1) else 0 end
  from keys k
  left join agg a on a.assignee is not distinct from k.k
  left join pay py on py.assignee is not distinct from k.k
  left join public.profiles pr on pr.id = k.k
  order by (k.k is null), coalesce(py.col, 0) desc, 2
$$;

create or replace function public.report_projects(p_from date default null, p_to date default null)
returns table(project_id uuid, name text, claims bigint, employees bigint, required numeric, collected numeric, remaining numeric, closed bigint, overdue bigint, pct numeric)
language sql stable set search_path = public as $$
  with c as (select * from public.claims_calc(null)),
  agg as (
    select project_id, count(*) as n, coalesce(sum(greatest(amount, 0)), 0) as req, coalesce(sum(rem), 0) as rem,
           count(*) filter (where closed) as cl,
           count(*) filter (where follow_up_date ~ '^\d{4}-\d{2}-\d{2}$' and follow_up_date < to_char(public.riyadh_today(), 'YYYY-MM-DD') and not closed) as od
    from c group by project_id
  ),
  pay as (
    select p.project_id, coalesce(sum(p.amount), 0) as col
    from public.claim_payments p
    where p.state = 'approved' and (p_from is null or p.paid_on >= p_from) and (p_to is null or p.paid_on <= p_to)
    group by p.project_id
  ),
  emp as (
    select pid as project_id, count(*) as n
    from (select unnest(pr.project_ids) as pid from public.profiles pr join public.user_roles r on r.user_id = pr.id
          where r.role = 'employee' and pr.active) x
    group by pid
  )
  select pj.id, pj.name, coalesce(a.n, 0), coalesce(e.n, 0), coalesce(a.req, 0), coalesce(py.col, 0), coalesce(a.rem, 0), coalesce(a.cl, 0), coalesce(a.od, 0),
         case when coalesce(a.req, 0) > 0 then round(coalesce(py.col, 0) / a.req * 100, 1) else 0 end
  from public.projects pj
  left join agg a on a.project_id = pj.id
  left join pay py on py.project_id = pj.id
  left join emp e on e.project_id = pj.id
  order by coalesce(py.col, 0) desc, pj.name
$$;

create or replace function public.report_status_dist(p_project uuid default null, p_employee uuid default null)
returns table(status_id text, name text, color text, claims bigint, remaining numeric)
language sql stable set search_path = public as $$
  with c as (select * from public.claims_calc(p_project) x where p_employee is null or x.assignee = p_employee),
  main as (
    select distinct on (s.id) s.id, s.name, s.color, s.ord
    from public.project_statuses(p_project) s where s.parent is null order by s.id, s.project_id
  )
  select m.id, m.name, m.color, count(c.id), coalesce(sum(c.rem), 0)
  from main m left join c on c.main_status = m.id
  group by m.id, m.name, m.color, m.ord order by m.ord
$$;

create or replace function public.report_overdue(
  p_project uuid default null, p_employee uuid default null, p_limit int default 50, p_offset int default 0)
returns table(project_id uuid, project_name text, claim_id text, data jsonb, assignee uuid, assignee_name text,
              remaining numeric, follow_up_date text, days_late int, status text, total_count bigint)
language sql stable set search_path = public as $$
  with c as (
    select * from public.claims_calc(p_project) x
    where (p_employee is null or x.assignee = p_employee)
      and x.follow_up_date ~ '^\d{4}-\d{2}-\d{2}$' and x.follow_up_date < to_char(public.riyadh_today(), 'YYYY-MM-DD') and not x.closed
  )
  select c.project_id, pj.name, c.id, c.data, c.assignee,
         case when c.assignee is null then 'غير موزّعة' else coalesce(pr.name, 'موظف محذوف') end,
         c.rem, c.follow_up_date, (public.riyadh_today() - c.follow_up_date::date)::int, c.main_status,
         count(*) over ()
  from c
  join public.projects pj on pj.id = c.project_id
  left join public.profiles pr on pr.id = c.assignee
  order by c.follow_up_date, c.id
  limit least(greatest(coalesce(p_limit, 50), 1), 500) offset greatest(coalesce(p_offset, 0), 0)
$$;

/* المتابعات اليومية لكل موظف — تُجمَّع في القاعدة (لا تُحمَّل آلاف السجلات للمتصفح) */
create or replace function public.report_daily_followups(p_project uuid, p_day date default null)
returns table(uid uuid, name text, n bigint)
language sql stable set search_path = public as $$
  with d as (select coalesce(p_day, public.riyadh_today()) as day)
  select h.by, coalesce(max(h.by_name), '—'), count(*)
  from public.claim_history h, d
  where h.project_id = p_project and h.type = 'update'
    and h.at >= (d.day::timestamp at time zone 'Asia/Riyadh')
    and h.at <  ((d.day + 1)::timestamp at time zone 'Asia/Riyadh')
    and (public.my_role() is distinct from 'employee' or h.by = auth.uid())
  group by h.by order by 3 desc, 2
$$;

/* ------------------------------------------------------------------ */
/* التوزيع كعملية واحدة (ذرّية)                                          */
/* ------------------------------------------------------------------ */
-- p_scope = 'unassigned': يوزّع غير الموزّع فقط ويحسب الأحمال الحالية.
-- p_scope = 'all'       : يعيد توزيع كل المطالبات غير المكوّدة.
-- p_apply = false       : معاينة فقط. نفس p_seed يعطي نفس النتيجة، فتطابق المعاينةُ التنفيذَ.
create or replace function public.distribute_claims(
  p_project uuid, p_employees uuid[], p_scope text default 'unassigned',
  p_seed double precision default null, p_apply boolean default false)
returns table(uid uuid, cur_count int, cur_sum numeric, add_count int, add_sum numeric)
language plpgsql set search_path = public as $$
declare
  want uuid[]; valid uuid[];
  n int; i int; j int;
  cnt int[]; sm numeric[]; addc int[]; adds numeric[]; curc int[]; curs numeric[];
  r record; amt numeric; mn_c int; mn_s numeric; cand int[]; near int[]; pick int;
  ids text[] := '{}'; tos uuid[] := '{}'; tc int; ts numeric;
begin
  if auth.uid() is null or not public.can_manage(p_project) then raise exception 'permission-denied'; end if;
  if p_scope not in ('unassigned', 'all') then raise exception 'نطاق التوزيع غير صحيح'; end if;
  select array_agg(distinct x) into want from unnest(coalesce(p_employees, '{}'::uuid[])) x;
  if want is null or cardinality(want) = 0 then raise exception 'اختر موظفًا واحدًا على الأقل'; end if;
  select array_agg(p.id order by p.name, p.id) into valid
  from public.profiles p join public.user_roles ur on ur.user_id = p.id
  where p.id = any(want) and p.active and ur.role = 'employee' and p_project = any(p.project_ids);
  if valid is null or cardinality(valid) <> cardinality(want) then raise exception 'الموظف غير صالح لهذا المشروع'; end if;
  n := cardinality(valid);

  curc := array_fill(0, array[n]); curs := array_fill(0::numeric, array[n]);
  for i in 1..n loop
    select count(*), coalesce(sum(greatest(c.amount, 0)), 0) into tc, ts
    from public.claims c where c.project_id = p_project and c.assignee = valid[i];
    curc[i] := tc; curs[i] := ts;
  end loop;
  if p_scope = 'unassigned' then cnt := curc; sm := curs;
  else cnt := array_fill(0, array[n]); sm := array_fill(0::numeric, array[n]); end if;
  addc := array_fill(0, array[n]); adds := array_fill(0::numeric, array[n]);

  if p_seed is not null then perform setseed(least(greatest(p_seed, -1), 1)); end if;

  for r in
    select c.id, greatest(c.amount, 0) as a, greatest(c.amount, 0) * (0.93 + 0.14 * random()) as k
    from public.claims c
    where c.project_id = p_project and (case when p_scope = 'unassigned' then c.assignee is null else not c.coded end)
    order by 3 desc, c.id
  loop
    amt := r.a;
    mn_c := null;
    for i in 1..n loop if mn_c is null or cnt[i] < mn_c then mn_c := cnt[i]; end if; end loop;
    cand := '{}';
    for i in 1..n loop if cnt[i] = mn_c then cand := cand || i; end if; end loop;
    mn_s := null;
    foreach j in array cand loop if mn_s is null or sm[j] < mn_s then mn_s := sm[j]; end if; end loop;
    near := '{}';
    foreach j in array cand loop if sm[j] <= mn_s + amt * 0.3 then near := near || j; end if; end loop;
    pick := near[1 + floor(random() * cardinality(near))::int];
    cnt[pick] := cnt[pick] + 1; sm[pick] := sm[pick] + amt;
    addc[pick] := addc[pick] + 1; adds[pick] := adds[pick] + amt;
    ids := ids || r.id; tos := tos || valid[pick];
  end loop;

  if p_apply and cardinality(ids) > 0 then
    update public.claims c set assignee = a.u, assigned_at = now(), assigned_by = auth.uid()
    from unnest(ids, tos) as a(i, u)
    where c.project_id = p_project and c.id = a.i and c.assignee is distinct from a.u;
  end if;

  return query select valid[g], curc[g], curs[g], addc[g], adds[g] from generate_series(1, n) g;
end $$;

/* ------------------------------------------------------------------ */
/* الاستيراد كعملية واحدة (ذرّية): إما كل شيء أو لا شيء                    */
/* ------------------------------------------------------------------ */
-- p_rows: [{ id, data:{عمود:قيمة}, amount, paid, has_id }]
-- p_apply = false: معاينة (يعدّ فقط).
create or replace function public.import_claims(
  p_project uuid, p_rows jsonb, p_columns text[], p_mapping jsonb, p_batch text, p_apply boolean default true)
returns jsonb
language plpgsql set search_path = public as $$
declare
  total int; v_add int; v_upd int; v_all int; base bigint;
  cols text[]; old_cols text[]; disp jsonb;
begin
  if auth.uid() is null or not public.can_manage(p_project) then raise exception 'permission-denied'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'بيانات الاستيراد غير صحيحة'; end if;
  total := jsonb_array_length(p_rows);
  if total > 100000 then raise exception 'عدد الصفوف كبير جدًا (الحد 100000). قسّم الملف.'; end if;
  if p_mapping is not null and jsonb_typeof(p_mapping) <> 'object' then raise exception 'بيانات الاستيراد غير صحيحة'; end if;
  if p_apply and (coalesce(p_batch, '') = '' or length(p_batch) > 100) then raise exception 'معرّف الملف غير صحيح'; end if;
  if coalesce(cardinality(p_columns), 0) > 300 or exists (select 1 from unnest(coalesce(p_columns, '{}')) c where length(c) = 0 or length(c) > 200) then
    raise exception 'أسماء الأعمدة غير صحيحة';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) e
    where jsonb_typeof(e) <> 'object'
       or jsonb_typeof(e->'id') <> 'string' or length(e->>'id') not between 1 and 200
       or jsonb_typeof(e->'data') <> 'object'
       or jsonb_typeof(e->'amount') <> 'number' or abs((e->>'amount')::numeric) > 1e15
       or jsonb_typeof(e->'paid') <> 'number' or abs((e->>'paid')::numeric) > 1e15
       or exists (select 1 from jsonb_each(e->'data') kv where jsonb_typeof(kv.value) <> 'string' or length(kv.key) > 200)
  ) then raise exception 'بيانات الاستيراد غير صحيحة'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) e, jsonb_each(e->'data') kv where length(kv.value #>> '{}') > 5000) then
    raise exception 'توجد خلية في الملف أطول من 5000 حرف. اختصرها ثم أعد الرفع.';
  end if;

  if not p_apply then
    with src as (
      select distinct on (e->>'id') e->>'id' as id, e->'data' as data, (e->>'amount')::numeric as amount, (e->>'paid')::numeric as paid,
             coalesce((e->>'has_id')::boolean, false) as has_id
      from jsonb_array_elements(p_rows) with ordinality t(e, ord) order by e->>'id', ord
    ),
    cls as (
      select s.*, c.id as ex_id,
             (c.id is not null and s.has_id and (
                exists (select 1 from jsonb_each_text(s.data) kv where coalesce(c.data->>kv.key, '') is distinct from kv.value)
                or c.amount <> s.amount or c.paid <> s.paid)) as will_update
      from src s left join public.claims c on c.project_id = p_project and c.id = s.id
    )
    select count(*) filter (where ex_id is null), count(*) filter (where will_update), count(*) into v_add, v_upd, v_all from cls;
    return jsonb_build_object('added', v_add, 'updated', v_upd, 'unchanged', v_all - v_add - v_upd, 'applied', false);
  end if;

  base := floor(extract(epoch from clock_timestamp()))::bigint * 100000;
  with src as (
    select distinct on (e->>'id') e->>'id' as id, e->'data' as data, (e->>'amount')::numeric as amount, (e->>'paid')::numeric as paid,
           coalesce((e->>'has_id')::boolean, false) as has_id, ord
    from jsonb_array_elements(p_rows) with ordinality t(e, ord) order by e->>'id', ord
  ),
  cls as (
    select s.*, c.id as ex_id, c.data as ex_data,
           (c.id is not null and s.has_id and (
              exists (select 1 from jsonb_each_text(s.data) kv where coalesce(c.data->>kv.key, '') is distinct from kv.value)
              or c.amount <> s.amount or c.paid <> s.paid)) as will_update
    from src s left join public.claims c on c.project_id = p_project and c.id = s.id
  ),
  ins as (
    insert into public.claims(project_id, id, data, amount, paid, seq, batch_id)
    select p_project, id, data, amount, paid, base + ord, p_batch from cls where ex_id is null
    returning 1
  ),
  upd as (
    update public.claims c set data = cls.ex_data || cls.data, amount = cls.amount, paid = cls.paid
    from cls where cls.will_update and c.project_id = p_project and c.id = cls.id
    returning 1
  )
  select (select count(*) from ins), (select count(*) from upd), (select count(*) from cls) into v_add, v_upd, v_all;

  -- أعمدة المشروع + ربط الأعمدة + الأعمدة المعروضة، في نفس العملية
  select array(select jsonb_array_elements_text(columns)) into old_cols from public.projects where id = p_project;
  select array_agg(x order by o) into cols
  from (select x, min(o) as o from unnest(coalesce(old_cols, '{}') || coalesce(p_columns, '{}')) with ordinality t(x, o) group by x) q;
  cols := coalesce(cols, '{}');
  update public.projects set
    columns = to_jsonb(cols),
    mapping = coalesce(p_mapping, mapping),
    display_cols = case when jsonb_array_length(display_cols) = 0 then to_jsonb(cols[1:4]) else display_cols end
  where id = p_project;

  return jsonb_build_object('added', v_add, 'updated', v_upd, 'unchanged', v_all - v_add - v_upd, 'applied', true);
end $$;

/* تحرير كل مطالبات موظف في مشروع (عند حذفه من الفريق) */
create or replace function public.release_claims(p_project uuid, p_from uuid) returns integer
language plpgsql set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null or not public.can_manage(p_project) then raise exception 'permission-denied'; end if;
  perform set_config('app.log_assign', 'on', true);
  perform set_config('app.allow_coded_move', 'on', true);
  update public.claims set assignee = null, assigned_at = now(), assigned_by = auth.uid()
  where project_id = p_project and assignee = p_from;
  get diagnostics n = row_count;
  perform set_config('app.log_assign', '', true);
  perform set_config('app.allow_coded_move', '', true);
  return n;
end $$;

/* ------------------------------------------------------------------ */
/* الصلاحيات: للمسجّلين فقط                                              */
/* ------------------------------------------------------------------ */
do $$
declare f text;
begin
  for f in select unnest(array[
    'riyadh_today()', 'project_statuses(uuid)', 'claims_calc(uuid)',
    'claims_filtered(uuid,text,text,text,text,boolean,boolean,text[])',
    'claims_page(uuid,text,text,text,text,boolean,boolean,text[],int,int)',
    'claims_ids(uuid,text,text,text,text,boolean,boolean)',
    'claims_due(uuid,text,int,int)', 'due_unseen_count(uuid)', 'project_stats(uuid)', 'status_in_use(uuid,text[])',
    'report_overview(uuid,uuid,date,date)', 'report_monthly(uuid,uuid,int)', 'report_employees(uuid,date,date)',
    'report_projects(date,date)', 'report_status_dist(uuid,uuid)', 'report_overdue(uuid,uuid,int,int)',
    'report_daily_followups(uuid,date)',
    'distribute_claims(uuid,uuid[],text,double precision,boolean)',
    'import_claims(uuid,jsonb,text[],jsonb,text,boolean)', 'release_claims(uuid,uuid)'
  ]) loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

/* ------------------------------------------------------------------ */
/* تشديد الأمان                                                          */
/* ------------------------------------------------------------------ */
-- التذكيرات: لا تُسجَّل «شوهدت» إلا لمطالبة يستطيع المستخدم نفسه رؤيتها.
drop policy if exists "own seen insert" on public.reminder_seen;
create policy "own seen insert" on public.reminder_seen for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.claims c where c.project_id = reminder_seen.project_id and c.id = reminder_seen.claim_id));

-- الزائر غير المسجّل (anon) لا يحتاج أي جدول ولا دالة؛ التطبيق يسجّل الدخول عبر خدمة Auth لا عبر قاعدة البيانات.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- دوال الصلاحيات التي تستعملها سياسات RLS: للمسجّلين فقط.
do $$
declare f text;
begin
  for f in select unnest(array['my_role()', 'my_projects()', 'can_manage(uuid)', 'is_emp_of(uuid)']) loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

commit;
