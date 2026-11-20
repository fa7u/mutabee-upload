create type public.app_role as enum ('owner','exec','supervisor','employee');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  username text not null unique,
  active boolean not null default true,
  project_ids uuid[] not null default '{}',
  created_by uuid,
  created_at timestamptz not null default now()
);
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role public.app_role not null
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create unique index one_owner on public.user_roles(role) where role = 'owner';

create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select r.role from public.user_roles r join public.profiles p on p.id = r.user_id
  where r.user_id = auth.uid() and p.active
$$;
create or replace function public.my_projects() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce((select project_ids from public.profiles where id = auth.uid() and active), '{}')
$$;
create or replace function public.can_manage(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('owner','exec')
    or (public.my_role() = 'supervisor' and p = any(public.my_projects())), false)
$$;
create or replace function public.is_emp_of(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'employee' and p = any(public.my_projects()), false)
$$;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  columns jsonb not null default '[]',
  display_cols jsonb not null default '[]',
  statuses jsonb not null default '[]',
  mapping jsonb not null default '{}',
  added_columns text[] not null default '{}',
  created_by uuid,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.projects to authenticated;
grant all on public.projects to service_role;
alter table public.projects enable row level security;
create policy "read projects" on public.projects for select to authenticated
  using (public.my_role() in ('owner','exec') or id = any(public.my_projects()));
create policy "create projects" on public.projects for insert to authenticated with check (public.my_role() in ('owner','exec'));
create policy "update projects" on public.projects for update to authenticated using (public.can_manage(id)) with check (public.can_manage(id));
create policy "delete projects" on public.projects for delete to authenticated using (public.my_role() in ('owner','exec'));

create table public.claims (
  project_id uuid not null references public.projects(id) on delete cascade,
  id text not null,
  data jsonb not null default '{}',
  amount numeric not null default 0,
  paid numeric not null default 0,
  approved_paid numeric not null default 0,
  settlement_amount numeric,
  assignee uuid,
  status text,
  note text not null default '',
  last_note text not null default '',
  follow_up_date text not null default '',
  seq bigint not null default 0,
  batch_id text,
  coded boolean not null default false,
  coded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  updated_by uuid,
  updated_by_name text,
  assigned_at timestamptz,
  assigned_by uuid,
  primary key (project_id, id)
);
create index claims_assignee_idx on public.claims(project_id, assignee);
grant select, insert, update, delete on public.claims to authenticated;
grant all on public.claims to service_role;
alter table public.claims enable row level security;
create policy "read claims" on public.claims for select to authenticated
  using (public.can_manage(project_id) or (public.is_emp_of(project_id) and assignee = auth.uid()));
create policy "insert claims" on public.claims for insert to authenticated with check (public.can_manage(project_id));
create policy "delete claims" on public.claims for delete to authenticated using (public.can_manage(project_id));
create policy "update claims" on public.claims for update to authenticated
  using (public.can_manage(project_id) or (public.is_emp_of(project_id) and assignee = auth.uid()))
  with check (public.can_manage(project_id) or (public.is_emp_of(project_id) and assignee = auth.uid()));

create table public.claim_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  claim_id text not null,
  at timestamptz not null default now(),
  by uuid not null,
  by_name text,
  type text not null,
  changes jsonb not null default '{}',
  foreign key (project_id, claim_id) references public.claims(project_id, id) on delete cascade
);
create index claim_history_idx on public.claim_history(project_id, claim_id, at desc);
grant select, delete on public.claim_history to authenticated;
grant all on public.claim_history to service_role;
alter table public.claim_history enable row level security;
create policy "read history" on public.claim_history for select to authenticated
  using (public.can_manage(project_id) or (public.is_emp_of(project_id)
    and exists (select 1 from public.claims c where c.project_id = claim_history.project_id and c.id = claim_history.claim_id and c.assignee = auth.uid())));
create policy "delete history" on public.claim_history for delete to authenticated using (public.can_manage(project_id));

create table public.claim_payments (
 id uuid primary key default gen_random_uuid(), project_id uuid not null, claim_id text not null,
 kind text not null, status_id text not null, amount numeric not null, discount_percent numeric,
 paid_on date not null default (now() at time zone 'Asia/Riyadh')::date,
 state text not null default 'pending', submitted_by uuid not null, submitted_at timestamptz not null default now(),
 reviewed_by uuid, reviewed_at timestamptz, review_note text not null default '',
 foreign key (project_id, claim_id) references public.claims(project_id,id) on delete cascade
);
grant select on public.claim_payments to authenticated;
grant all on public.claim_payments to service_role;
alter table public.claim_payments enable row level security;
create policy "read visible payments" on public.claim_payments for select to authenticated using (public.can_manage(project_id) or (public.is_emp_of(project_id) and exists (select 1 from public.claims c where c.project_id=claim_payments.project_id and c.id=claim_payments.claim_id and c.assignee=auth.uid())));
create unique index one_pending_payment on public.claim_payments(project_id,claim_id) where state='pending';

create table public.claim_favorites (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null,
  claim_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id, claim_id),
  foreign key (project_id, claim_id) references public.claims(project_id, id) on delete cascade
);
grant select, insert, delete on public.claim_favorites to authenticated;
grant all on public.claim_favorites to service_role;
alter table public.claim_favorites enable row level security;
create policy "read favorites" on public.claim_favorites for select to authenticated
  using (user_id = auth.uid() or public.can_manage(project_id));
create policy "add own favorite" on public.claim_favorites for insert to authenticated
  with check (user_id = auth.uid() and (public.can_manage(project_id) or (public.is_emp_of(project_id) and exists (select 1 from public.claims c where c.project_id = claim_favorites.project_id and c.id = claim_favorites.claim_id and c.assignee = auth.uid()))));
create policy "remove own favorite" on public.claim_favorites for delete to authenticated using (user_id = auth.uid());

create table public.reminder_seen (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  claim_id text not null,
  due_date text not null,
  seen_at timestamptz not null default now(),
  primary key (user_id, project_id, claim_id, due_date)
);
grant select, insert, delete on public.reminder_seen to authenticated;
grant all on public.reminder_seen to service_role;
alter table public.reminder_seen enable row level security;
create policy "own seen select" on public.reminder_seen for select to authenticated
  using (user_id = (select auth.uid()) or public.can_manage(project_id));
create policy "own seen insert" on public.reminder_seen for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own seen delete" on public.reminder_seen for delete to authenticated using (user_id = (select auth.uid()));

create table public.coding_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  claim_id text not null,
  requested_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  note text not null default '',
  state text not null default 'pending' check (state in ('pending', 'approved', 'rejected', 'removed')),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text not null default '',
  foreign key (project_id, claim_id) references public.claims(project_id, id) on delete cascade
);
create unique index one_pending_coding on public.coding_requests(project_id, claim_id) where state = 'pending';
create index coding_requests_project on public.coding_requests(project_id, state);
grant select on public.coding_requests to authenticated;
grant all on public.coding_requests to service_role;
alter table public.coding_requests enable row level security;
create policy "read coding requests" on public.coding_requests for select to authenticated
  using (requested_by = (select auth.uid()) or public.can_manage(project_id));

create or replace function public.can_see_user(p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    p_uid = auth.uid()
    or public.my_role() in ('owner','exec')
    or (public.my_role() = 'supervisor' and (
         exists (select 1 from public.profiles pr where pr.id = p_uid and pr.project_ids && public.my_projects())
         or exists (select 1 from public.user_roles r where r.user_id = p_uid and r.role in ('owner','exec'))
         or exists (select 1 from public.claims c where c.assignee = p_uid and c.project_id = any(public.my_projects()))
       )),
    false)
$$;
revoke all on function public.can_see_user(uuid) from public, anon;
grant execute on function public.can_see_user(uuid) to authenticated;
create policy "read profiles" on public.profiles for select to authenticated using (public.can_see_user(id));
create policy "read roles" on public.user_roles for select to authenticated using (public.can_see_user(user_id));

create or replace function public.claim_status_name(p_project uuid, p_id text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s->>'name' from public.projects p, jsonb_array_elements(p.statuses) s
      where p.id = p_project and s->>'id' = p_id limit 1),
    case p_id
      when 's_new' then 'جديد'
      when 's_contacted' then 'تم التواصل'
      when 's_promise' then 'وعد بالسداد'
      when 's_refused' then 'رفض'
      when 's_noreply' then 'لا يرد'
      when 's_paid' then 'تم السداد'
      when 's_partial' then 'سداد جزئي'
      when 's_scheduled' then 'سداد جدولة'
      when 's_discount' then 'سداد بالخصم'
    end)
$$;
revoke all on function public.claim_status_name(uuid, text) from public, anon;
grant execute on function public.claim_status_name(uuid, text) to authenticated;

create or replace function public.claims_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.can_manage(old.project_id) then return new; end if;
  if current_setting('app.claim_write', true) is distinct from 'save'
     and current_setting('app.claim_write', true) is distinct from 'payment' then
    raise exception 'permission-denied';
  end if;
  if new.amount is distinct from old.amount or new.paid is distinct from old.paid
     or new.assignee is distinct from old.assignee or new.seq is distinct from old.seq or new.batch_id is distinct from old.batch_id
     or new.project_id is distinct from old.project_id or new.id is distinct from old.id
     or new.assigned_at is distinct from old.assigned_at or new.assigned_by is distinct from old.assigned_by then
    raise exception 'permission-denied';
  end if;
  if new.updated_by is distinct from auth.uid() then raise exception 'permission-denied'; end if;
  return new;
end $$;
create trigger claims_guard before update on public.claims for each row execute function public.claims_guard();

create or replace function public.protect_approved_payments() returns trigger language plpgsql set search_path=public as $$
begin
 if tg_op='INSERT' then
  if new.approved_paid <> 0 or new.settlement_amount is not null then raise exception 'السداد يحتاج موافقة المشرف'; end if;
 elsif (new.approved_paid is distinct from old.approved_paid or new.settlement_amount is distinct from old.settlement_amount)
   and pg_trigger_depth() < 2 and current_setting('app.payment_override', true) is distinct from 'on' then
  raise exception 'السداد يحتاج موافقة المشرف';
 end if;
 return new;
end $$;
create trigger protect_approved_payments before insert or update on public.claims for each row execute function public.protect_approved_payments();

create or replace function public.claims_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ch jsonb := '{}'::jsonb;
  pname text;
  k text;
  mode text := current_setting('app.claim_write', true);
  orig text := coalesce(current_setting('app.orig_note', true), '');
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then return null; end if;
  select name into pname from public.profiles where id = auth.uid();
  if mode = 'save' then
    if coalesce(new.status, 's_new') <> coalesce(old.status, 's_new') then
      ch := ch || jsonb_build_object('status', jsonb_build_array(
        public.claim_status_name(new.project_id, coalesce(old.status, 's_new')),
        public.claim_status_name(new.project_id, coalesce(new.status, 's_new'))));
    end if;
    if new.follow_up_date is distinct from old.follow_up_date then
      ch := ch || jsonb_build_object('followUpDate', jsonb_build_array(old.follow_up_date, new.follow_up_date));
    end if;
    if orig <> '' or new.note is distinct from old.note then
      ch := ch || jsonb_build_object('note', jsonb_build_array(old.note, case when orig <> '' then orig else new.note end));
    end if;
    for k in select key from jsonb_each(new.data) loop
      if (old.data ->> k) is distinct from (new.data ->> k) then
        ch := ch || jsonb_build_object('data:' || k, jsonb_build_array(coalesce(old.data ->> k, ''), coalesce(new.data ->> k, '')));
      end if;
    end loop;
    if ch <> '{}'::jsonb then
      insert into public.claim_history(project_id, claim_id, by, by_name, type, changes)
      values (new.project_id, new.id, auth.uid(), pname, 'update', ch);
    end if;
  end if;
  if current_setting('app.log_assign', true) = 'on' and new.assignee is distinct from old.assignee then
    insert into public.claim_history(project_id, claim_id, by, by_name, type, changes)
    values (new.project_id, new.id, auth.uid(), pname, 'assign', jsonb_build_object('assignee', jsonb_build_array(
      case when old.assignee is null then 'غير موزّعة'
           else coalesce((select name from public.profiles where id = old.assignee), 'موظف محذوف') end,
      case when new.assignee is null then 'غير موزّعة'
           else coalesce((select name from public.profiles where id = new.assignee), 'موظف محذوف') end)));
  end if;
  return null;
end $$;
create trigger claims_audit after update on public.claims for each row execute function public.claims_audit();

create or replace function public.payment_apply_review() returns trigger language plpgsql security definer set search_path=public as $$
declare c public.claims; pname text;
begin
 if new.state not in ('approved','rejected') or old.state <> 'pending' then raise exception 'الطلب ليس قيد المراجعة'; end if;
 select * into c from public.claims where project_id=new.project_id and id=new.claim_id for update;
 select name into pname from public.profiles where id=auth.uid();
 if new.state='approved' then
  if new.amount > greatest(coalesce(c.settlement_amount,c.amount)-c.approved_paid,0) then raise exception 'المبلغ أكبر من المتبقي'; end if;
  update public.claims set approved_paid=approved_paid+new.amount,
   settlement_amount=case when new.kind='discount' then approved_paid+new.amount else settlement_amount end,
   status=new.status_id, updated_at=now(),updated_by=auth.uid(),updated_by_name=pname
   where project_id=new.project_id and id=new.claim_id;
 end if;
 insert into public.claim_history(project_id,claim_id,by,by_name,type,changes) values(new.project_id,new.claim_id,auth.uid(),pname,'payment_review',jsonb_build_object('السداد',jsonb_build_array('بانتظار الموافقة',case when new.state='approved' then 'معتمد: '||new.amount::text else 'مرفوض: '||new.review_note end)));
 return new;
end $$;
create trigger payment_review after update of state on public.claim_payments for each row execute function public.payment_apply_review();

create or replace function public.queue_imported_payment() returns trigger language plpgsql security definer set search_path=public as $$
declare delta numeric; actor uuid;
begin
 delta:=case when tg_op='INSERT' then new.paid else new.paid-old.paid end;
 actor:=coalesce(auth.uid(),new.updated_by);
 if delta>0 and actor is not null then
  insert into public.claim_payments(project_id,claim_id,kind,status_id,amount,submitted_by) values(new.project_id,new.id,'partial','s_partial',delta,actor);
 end if;
 return new;
end $$;
create trigger queue_imported_payment after insert or update of paid on public.claims for each row execute function public.queue_imported_payment();

create or replace function public.submit_claim_payment(p_project uuid,p_claim text,p_kind text,p_status text,p_amount numeric,p_discount numeric,p_date date) returns uuid
language plpgsql security definer set search_path=public as $$
declare c public.claims; rid uuid; pname text; remaining numeric; expected_kind text;
begin
 select * into c from public.claims where project_id=p_project and id=p_claim for update;
 if not found or not (public.can_manage(p_project) or (public.is_emp_of(p_project) and c.assignee=auth.uid())) then raise exception 'permission-denied'; end if;
 expected_kind := case p_status when 's_partial' then 'partial' when 's_scheduled' then 'scheduled' when 's_discount' then 'discount' else 'full' end;
 if p_kind <> expected_kind then raise exception 'نوع السداد غير صحيح'; end if;
 if p_kind='full' and not exists (select 1 from public.projects p, jsonb_array_elements(p.statuses) s where p.id=p_project and s->>'id'=p_status and (s->>'paid')::boolean) then raise exception 'حالة السداد غير صحيحة'; end if;
 remaining:=greatest(coalesce(c.settlement_amount,c.amount)-c.approved_paid,0);
 if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or p_amount>remaining then raise exception 'أدخل مبلغًا أكبر من صفر ولا يتجاوز المتبقي'; end if;
 if p_kind='full' and p_amount<>remaining then raise exception 'السداد الكامل يجب أن يساوي المتبقي'; end if;
 if p_kind='discount' and (p_discount is null or p_discount::text in ('NaN','Infinity','-Infinity') or p_discount<0 or p_discount>100) then raise exception 'نسبة الخصم بين 0 و100'; end if;
 if p_date is null or p_date>(now() at time zone 'Asia/Riyadh')::date then raise exception 'تاريخ السداد غير صحيح'; end if;
 if exists(select 1 from public.claim_payments where project_id=p_project and claim_id=p_claim and state='pending') then raise exception 'يوجد سداد بانتظار موافقة المشرف'; end if;
 select name into pname from public.profiles where id=auth.uid();
 insert into public.claim_payments(project_id,claim_id,kind,status_id,amount,discount_percent,paid_on,submitted_by) values(p_project,p_claim,p_kind,p_status,p_amount,case when p_kind='discount' then p_discount end,p_date,auth.uid()) returning id into rid;
 perform set_config('app.claim_write','payment',true);
 update public.claims set status=p_status,follow_up_date=case when p_kind='scheduled' then to_char(p_date+interval '1 month','YYYY-MM-DD') else follow_up_date end,updated_by=auth.uid(),updated_by_name=pname,updated_at=now() where project_id=p_project and id=p_claim;
 perform set_config('app.claim_write','',true);
 insert into public.claim_history(project_id,claim_id,by,by_name,type,changes) values(p_project,p_claim,auth.uid(),pname,'payment_submitted',jsonb_build_object('السداد',jsonb_build_array('', 'بانتظار موافقة المشرف: '||p_amount::text)));
 return rid;
end $$;
revoke all on function public.submit_claim_payment(uuid,text,text,text,numeric,numeric,date) from public, anon;
grant execute on function public.submit_claim_payment(uuid,text,text,text,numeric,numeric,date) to authenticated;

create or replace function public.can_review_payment_row(p public.claim_payments) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    p.state = 'pending' and p.submitted_by is distinct from auth.uid() and (
      (public.my_role() = 'supervisor' and p.project_id = any (public.my_projects()))
      or public.my_role() in ('owner', 'exec')
    ), false)
$$;
grant execute on function public.can_review_payment_row(public.claim_payments) to authenticated;

create or replace function public.review_claim_payment(p_id uuid, p_approve boolean, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare p public.claim_payments;
begin
  select * into p from public.claim_payments where id = p_id for update;
  if not found then raise exception 'السداد غير موجود'; end if;
  if p.state <> 'pending' then raise exception 'تمت مراجعة هذا السداد مسبقًا'; end if;
  if p.submitted_by = auth.uid() then raise exception 'لا يمكنك اعتماد سداد قدّمتَه بنفسك'; end if;
  if not public.can_review_payment_row(p) then raise exception 'ليس لديك صلاحية اعتماد هذا السداد'; end if;
  update public.claim_payments
     set state = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = coalesce(p_note, '')
   where id = p_id;
end $$;
revoke all on function public.review_claim_payment(uuid, boolean, text) from public, anon;
grant execute on function public.review_claim_payment(uuid, boolean, text) to authenticated;

create or replace function public.delete_claim_payment(p_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare p public.claim_payments; pname text;
begin
 select * into p from public.claim_payments where id = p_id for update;
 if not found or not public.can_manage(p.project_id) then raise exception 'permission-denied'; end if;
 select name into pname from public.profiles where id = auth.uid();
 if p.state = 'approved' then
  perform set_config('app.payment_override', 'on', true);
  update public.claims set
    approved_paid = greatest(approved_paid - p.amount, 0),
    settlement_amount = case when p.kind = 'discount' then null else settlement_amount end,
    status = case when status = p.status_id then 's_new' else status end,
    updated_at = now(), updated_by = auth.uid(), updated_by_name = pname
  where project_id = p.project_id and id = p.claim_id;
 end if;
 delete from public.claim_payments where id = p_id;
 insert into public.claim_history(project_id, claim_id, by, by_name, type, changes)
 values (p.project_id, p.claim_id, auth.uid(), pname, 'payment_deleted',
         jsonb_build_object('السداد', jsonb_build_array(p.kind || ': ' || p.amount::text, 'حُذف')));
end $$;
revoke all on function public.delete_claim_payment(uuid) from public, anon;
grant execute on function public.delete_claim_payment(uuid) to authenticated;

create or replace function public.reset_project_claims(p_project uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare n integer; pname text;
begin
 if not public.can_manage(p_project) then raise exception 'permission-denied'; end if;
 select name into pname from public.profiles where id = auth.uid();
 perform set_config('app.payment_override', 'on', true);
 update public.claims set status = 's_new', note = '', follow_up_date = '', paid = 0,
   approved_paid = 0, settlement_amount = null,
   updated_at = now(), updated_by = auth.uid(), updated_by_name = pname
 where project_id = p_project;
 get diagnostics n = row_count;
 delete from public.claim_payments where project_id = p_project;
 return n;
end $$;
revoke all on function public.reset_project_claims(uuid) from public, anon;
grant execute on function public.reset_project_claims(uuid) to authenticated;

create or replace function public.delete_claim_batch(p_project uuid, p_batch text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
 if not public.can_manage(p_project) then raise exception 'permission-denied'; end if;
 delete from public.claim_payments where project_id = p_project
   and claim_id in (select id from public.claims where project_id = p_project and batch_id = p_batch);
 delete from public.claim_history where project_id = p_project
   and claim_id in (select id from public.claims where project_id = p_project and batch_id = p_batch);
 delete from public.claims where project_id = p_project and batch_id = p_batch;
 get diagnostics n = row_count;
 if not exists (select 1 from public.claims where project_id = p_project) then
   update public.projects set columns = '[]'::jsonb, display_cols = '[]'::jsonb, mapping = '{}'::jsonb
   where id = p_project;
 end if;
 return n;
end $$;
revoke all on function public.delete_claim_batch(uuid, text) from public, anon;
grant execute on function public.delete_claim_batch(uuid, text) to authenticated;

create or replace function public.save_claim_update(
  p_project uuid, p_claim text, p_status text default null, p_note text default null,
  p_follow_up text default null, p_data jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.claims; pname text; cols jsonb; added text[]; k text; v jsonb; val text; new_data jsonb;
  data_changed boolean := false; st_changed boolean; fu_changed boolean; note_changed boolean;
  note_txt text := btrim(coalesce(p_note, ''));
begin
  if auth.uid() is null then raise exception 'permission-denied'; end if;
  select * into c from public.claims where project_id = p_project and id = p_claim for update;
  if not found or not (public.can_manage(p_project) or (public.is_emp_of(p_project) and c.assignee = auth.uid())) then
    raise exception 'permission-denied';
  end if;
  select name into pname from public.profiles where id = auth.uid();
  if p_status is not null and public.claim_status_name(p_project, p_status) is null then
    raise exception 'حالة غير صحيحة';
  end if;
  if p_follow_up is not null and p_follow_up <> '' then
    begin
      if p_follow_up !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'x'; end if;
      perform p_follow_up::date;
    exception when others then
      raise exception 'تاريخ المتابعة غير صحيح';
    end;
  end if;
  if length(note_txt) > 5000 then raise exception 'الملاحظة طويلة جدًا'; end if;
  new_data := c.data;
  if p_data is not null then
    if jsonb_typeof(p_data) <> 'object' then raise exception 'بيانات غير صحيحة'; end if;
    select columns, added_columns into cols, added from public.projects where id = p_project;
    for k, v in select key, value from jsonb_each(p_data) loop
      if jsonb_typeof(v) <> 'string' then raise exception 'بيانات غير صحيحة'; end if;
      val := btrim(v #>> '{}');
      if length(val) > 2000 then raise exception 'القيمة طويلة جدًا'; end if;
      if not (coalesce(cols, '[]'::jsonb) ? k or c.data ? k) then raise exception 'عمود غير معروف'; end if;
      if not public.can_manage(p_project) and not (k = any (coalesce(added, '{}'))) and coalesce(c.data ->> k, '') <> val then
        raise exception 'لا يمكنك تعديل هذا العمود';
      end if;
      if coalesce(c.data ->> k, '') <> val then
        new_data := jsonb_set(new_data, array[k], to_jsonb(val));
        data_changed := true;
      end if;
    end loop;
  end if;
  st_changed := p_status is not null and p_status <> coalesce(c.status, 's_new');
  fu_changed := p_follow_up is not null and p_follow_up <> c.follow_up_date;
  note_changed := p_note is not null and (note_txt <> '' or c.note <> '');
  if not (st_changed or fu_changed or note_changed or data_changed) then return; end if;
  perform set_config('app.claim_write', 'save', true);
  perform set_config('app.orig_note', case when note_changed then note_txt else '' end, true);
  update public.claims set
    status = case when st_changed then p_status else status end,
    follow_up_date = case when fu_changed then p_follow_up else follow_up_date end,
    note = case when note_changed then (case when note_txt <> '' then 'تحديث على نفس الحالة' else '' end) else note end,
    last_note = case when note_changed and note_txt <> '' then note_txt else last_note end,
    data = new_data,
    updated_at = now(), updated_by = auth.uid(), updated_by_name = pname
  where project_id = p_project and id = p_claim;
  perform set_config('app.claim_write', '', true);
  perform set_config('app.orig_note', '', true);
end $$;
revoke all on function public.save_claim_update(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.save_claim_update(uuid, text, text, text, text, jsonb) to authenticated;

create or replace function public.move_favorites_with_claim() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.assignee is not null and new.assignee is distinct from old.assignee then
    if new.assignee is not null then
      insert into public.claim_favorites(user_id, project_id, claim_id)
        select new.assignee, project_id, claim_id from public.claim_favorites
        where user_id = old.assignee and project_id = old.project_id and claim_id = old.id
      on conflict do nothing;
    end if;
    delete from public.claim_favorites where user_id = old.assignee and project_id = old.project_id and claim_id = old.id;
  end if;
  return null;
end $$;
create trigger claims_move_favorites after update of assignee on public.claims
  for each row execute function public.move_favorites_with_claim();

create or replace function public.claims_coded_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assignee is distinct from old.assignee then
    if new.assignee is null then
      new.coded := false; new.coded_at := null;
    elsif old.coded and coalesce(current_setting('app.allow_coded_move', true), '') <> 'on' then
      new.assignee := old.assignee; new.assigned_at := old.assigned_at; new.assigned_by := old.assigned_by;
    end if;
  end if;
  return new;
end $$;
create trigger claims_coded_guard before update of assignee on public.claims
  for each row execute function public.claims_coded_guard();

create or replace function public.claims_coding_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assignee is distinct from old.assignee then
    update public.coding_requests set state = 'removed', reviewed_at = coalesce(reviewed_at, now())
    where project_id = new.project_id and claim_id = new.id
      and (state = 'pending' or (state = 'approved' and new.assignee is null));
  end if;
  return null;
end $$;
create trigger claims_coding_cleanup after update of assignee on public.claims
  for each row execute function public.claims_coding_cleanup();

create or replace function public.transfer_claims(p_project uuid, p_ids text[], p_to uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.can_manage(p_project) then raise exception 'permission-denied'; end if;
  if p_to is not null and not exists (
    select 1 from public.profiles p join public.user_roles r on r.user_id = p.id
    where p.id = p_to and p.active and r.role = 'employee' and p_project = any(p.project_ids)
  ) then
    raise exception 'الموظف غير صالح لهذا المشروع';
  end if;
  perform set_config('app.log_assign', 'on', true);
  perform set_config('app.allow_coded_move', 'on', true);
  update public.claims set assignee = p_to, assigned_at = now(), assigned_by = auth.uid()
  where project_id = p_project and id = any(p_ids) and assignee is distinct from p_to;
  get diagnostics n = row_count;
  perform set_config('app.log_assign', '', true);
  perform set_config('app.allow_coded_move', '', true);
  return n;
end $$;
revoke all on function public.transfer_claims(uuid, text[], uuid) from public, anon;
grant execute on function public.transfer_claims(uuid, text[], uuid) to authenticated;

create or replace function public.request_coding(p_project uuid, p_claim text, p_note text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.claims; rid uuid;
begin
  select * into c from public.claims where project_id = p_project and id = p_claim for update;
  if not found or not (public.is_emp_of(p_project) and c.assignee = auth.uid()) then raise exception 'permission-denied'; end if;
  if c.coded then raise exception 'العميل مكود مسبقًا'; end if;
  if exists (select 1 from public.coding_requests where project_id = p_project and claim_id = p_claim and state = 'pending') then
    raise exception 'يوجد طلب تكويد بانتظار الموافقة';
  end if;
  if length(coalesce(p_note, '')) > 1000 then raise exception 'الملاحظة طويلة جدًا'; end if;
  insert into public.coding_requests(project_id, claim_id, requested_by, note)
  values (p_project, p_claim, auth.uid(), btrim(coalesce(p_note, ''))) returning id into rid;
  return rid;
end $$;
revoke all on function public.request_coding(uuid, text, text) from public, anon;
grant execute on function public.request_coding(uuid, text, text) to authenticated;

create or replace function public.review_coding(p_id uuid, p_approve boolean, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare r public.coding_requests; c public.claims; pname text;
begin
  select * into r from public.coding_requests where id = p_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if not public.can_manage(r.project_id) then raise exception 'permission-denied'; end if;
  if r.state <> 'pending' then raise exception 'تمت مراجعة هذا الطلب مسبقًا'; end if;
  select * into c from public.claims where project_id = r.project_id and id = r.claim_id for update;
  if not found or c.assignee is distinct from r.requested_by then
    update public.coding_requests set state = 'removed', reviewed_at = now() where id = p_id;
    raise exception 'تغيّر الموظف المسؤول عن العميل، أُلغي الطلب';
  end if;
  update public.coding_requests
     set state = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = btrim(coalesce(p_note, ''))
   where id = p_id;
  if p_approve then
    update public.claims set coded = true, coded_at = now() where project_id = r.project_id and id = r.claim_id;
    select name into pname from public.profiles where id = auth.uid();
    insert into public.claim_history(project_id, claim_id, by, by_name, type, changes)
    values (r.project_id, r.claim_id, auth.uid(), pname, 'coding', jsonb_build_object('تكويد', jsonb_build_array('', 'تم التكويد')));
  end if;
end $$;
revoke all on function public.review_coding(uuid, boolean, text) from public, anon;
grant execute on function public.review_coding(uuid, boolean, text) to authenticated;

create or replace function public.remove_coding(p_project uuid, p_claim text) returns void
language plpgsql security definer set search_path = public as $$
declare pname text;
begin
  if not public.can_manage(p_project) then raise exception 'permission-denied'; end if;
  update public.claims set coded = false, coded_at = null where project_id = p_project and id = p_claim and coded;
  if found then
    update public.coding_requests set state = 'removed', reviewed_at = now()
      where project_id = p_project and claim_id = p_claim and state = 'approved';
    select name into pname from public.profiles where id = auth.uid();
    insert into public.claim_history(project_id, claim_id, by, by_name, type, changes)
    values (p_project, p_claim, auth.uid(), pname, 'coding', jsonb_build_object('تكويد', jsonb_build_array('مكود', 'أُلغي التكويد')));
  end if;
end $$;
revoke all on function public.remove_coding(uuid, text) from public, anon;
grant execute on function public.remove_coding(uuid, text) to authenticated;

alter publication supabase_realtime add table public.claims;
alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.profiles;