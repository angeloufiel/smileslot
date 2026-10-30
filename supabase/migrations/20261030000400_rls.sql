-- =====================================================================
-- Migration 4: Row Level Security
--
-- Two layers:
--   1. GRANTs say which roles may even attempt SELECT/INSERT/UPDATE/DELETE.
--   2. RLS policies say which ROWS each person can see or change.
-- Column-level rules (e.g. "patients may only edit name and phone") are
-- enforced by the guard triggers in migration 2.
--
-- Roles in this app:
--   anon          not logged in (guests)
--   patient       logged-in customer: only their own records
--   dentist       their own appointments and those patients only
--   receptionist  front desk: all operational data
--   owner         everything, plus settings, roles and audit logs
--
-- (select auth.uid()) is wrapped in a sub-select so Postgres evaluates it
-- once per query instead of once per row (Supabase performance advice).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Start from zero privileges, then grant deliberately.
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Public catalog: anyone can read (RLS still hides inactive rows)
grant select on public.clinic_settings, public.service_categories, public.services,
               public.resources, public.service_resources, public.working_hours,
               public.clinic_closures
  to anon, authenticated;

-- Logged-in users (RLS narrows each of these down per role)
grant insert, update, delete on public.service_categories, public.services, public.resources,
                                public.service_resources, public.working_hours,
                                public.clinic_closures, public.resource_time_off
  to authenticated;
grant select on public.resource_time_off to authenticated;
grant update on public.clinic_settings to authenticated;
grant select, update                 on public.profiles      to authenticated;
grant select, insert, update         on public.customers     to authenticated;
grant select, insert, update         on public.reservations  to authenticated;
grant select, insert                 on public.reservation_notes to authenticated;
grant select                         on public.reservation_status_history to authenticated;
grant select, insert, update         on public.payments      to authenticated;
grant select, update                 on public.notifications to authenticated;
grant select                         on public.audit_logs    to authenticated;

-- ---------------------------------------------------------------------
-- 2. Enable RLS on every table. With RLS on and no matching policy,
--    the answer is always "no rows".
-- ---------------------------------------------------------------------
alter table public.clinic_settings            enable row level security;
alter table public.profiles                   enable row level security;
alter table public.service_categories         enable row level security;
alter table public.services                   enable row level security;
alter table public.resources                  enable row level security;
alter table public.service_resources          enable row level security;
alter table public.working_hours              enable row level security;
alter table public.clinic_closures            enable row level security;
alter table public.resource_time_off          enable row level security;
alter table public.customers                  enable row level security;
alter table public.reservations               enable row level security;
alter table public.reservation_notes          enable row level security;
alter table public.reservation_status_history enable row level security;
alter table public.payments                   enable row level security;
alter table public.notifications              enable row level security;
alter table public.audit_logs                 enable row level security;

-- ---------------------------------------------------------------------
-- Clinic settings: public read, owner edits
-- ---------------------------------------------------------------------
create policy "settings: anyone can read"
  on public.clinic_settings for select to anon, authenticated using (true);

create policy "settings: owner can update"
  on public.clinic_settings for update to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

-- ---------------------------------------------------------------------
-- Catalog tables: public sees active items; front desk manages.
-- ---------------------------------------------------------------------
create policy "categories: anyone can read"
  on public.service_categories for select to anon, authenticated using (true);
create policy "categories: front desk manages"
  on public.service_categories for all to authenticated
  using ((select private.is_front_desk())) with check ((select private.is_front_desk()));

create policy "services: public sees active, staff see all"
  on public.services for select to anon, authenticated
  using (is_active or (select private.is_staff()));
create policy "services: front desk manages"
  on public.services for all to authenticated
  using ((select private.is_front_desk())) with check ((select private.is_front_desk()));

create policy "resources: public sees active, staff see all"
  on public.resources for select to anon, authenticated
  using (is_active or (select private.is_staff()));
create policy "resources: front desk manages"
  on public.resources for all to authenticated
  using ((select private.is_front_desk())) with check ((select private.is_front_desk()));

create policy "service_resources: anyone can read"
  on public.service_resources for select to anon, authenticated using (true);
create policy "service_resources: front desk manages"
  on public.service_resources for all to authenticated
  using ((select private.is_front_desk())) with check ((select private.is_front_desk()));

create policy "working_hours: anyone can read"
  on public.working_hours for select to anon, authenticated using (true);
create policy "working_hours: front desk manages"
  on public.working_hours for all to authenticated
  using ((select private.is_front_desk())) with check ((select private.is_front_desk()));

create policy "closures: anyone can read"
  on public.clinic_closures for select to anon, authenticated using (true);
create policy "closures: front desk manages"
  on public.clinic_closures for all to authenticated
  using ((select private.is_front_desk())) with check ((select private.is_front_desk()));

-- Time-off reasons can be personal ("medical leave"): staff only.
create policy "time_off: staff can read"
  on public.resource_time_off for select to authenticated
  using ((select private.is_staff()));
create policy "time_off: front desk manages"
  on public.resource_time_off for all to authenticated
  using ((select private.is_front_desk())) with check ((select private.is_front_desk()));

-- ---------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------
create policy "profiles: read own, staff read all"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_staff()));

-- Own row OR owner. Which columns may change is enforced by trg_guard.
create policy "profiles: update own or owner updates any"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select private.is_owner()))
  with check (id = (select auth.uid()) or (select private.is_owner()));

-- ---------------------------------------------------------------------
-- Customers (patients)
-- ---------------------------------------------------------------------
create policy "customers: own, dentist patients, front desk all"
  on public.customers for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select private.is_front_desk())
    or id in (select private.my_patient_ids())
  );

create policy "customers: front desk creates"
  on public.customers for insert to authenticated
  with check ((select private.is_front_desk()));

create policy "customers: patient updates own, front desk updates any"
  on public.customers for update to authenticated
  using (profile_id = (select auth.uid()) or (select private.is_front_desk()))
  with check (profile_id = (select auth.uid()) or (select private.is_front_desk()));

-- ---------------------------------------------------------------------
-- Reservations — the heart of the "who sees which record" story
-- ---------------------------------------------------------------------
create policy "reservations: patient own, dentist assigned, front desk all"
  on public.reservations for select to authenticated
  using (
    (select private.is_front_desk())
    or customer_id = (select private.my_customer_id())
    or resource_id in (select private.my_resource_ids())
  );

-- Patients book through book_appointment(); only front desk inserts directly
-- (walk-ins, phone bookings).
create policy "reservations: front desk creates"
  on public.reservations for insert to authenticated
  with check ((select private.is_front_desk()));

-- Dentists can update their assigned appointments; the trigger limits them to status changes.
create policy "reservations: front desk or assigned dentist updates"
  on public.reservations for update to authenticated
  using ((select private.is_front_desk()) or resource_id in (select private.my_resource_ids()))
  with check ((select private.is_front_desk()) or resource_id in (select private.my_resource_ids()));

-- No DELETE policy: reservations are cancelled, never deleted (keeps history and reports honest).

-- ---------------------------------------------------------------------
-- Internal notes: staff who can see the reservation. Patients never.
-- ---------------------------------------------------------------------
create policy "notes: staff read notes on reservations they can see"
  on public.reservation_notes for select to authenticated
  using (
    (select private.is_staff())
    and exists (select 1 from public.reservations r where r.id = reservation_id)  -- inherits reservations RLS
  );

create policy "notes: staff add notes as themselves"
  on public.reservation_notes for insert to authenticated
  with check (
    (select private.is_staff())
    and author_id = (select auth.uid())
    and exists (select 1 from public.reservations r where r.id = reservation_id)
  );

-- ---------------------------------------------------------------------
-- Status history: visible to anyone who can see the reservation.
-- The EXISTS sub-query runs under the reservations policy above, so the
-- rule is defined in exactly one place.
-- ---------------------------------------------------------------------
create policy "history: follows reservation visibility"
  on public.reservation_status_history for select to authenticated
  using (exists (select 1 from public.reservations r where r.id = reservation_id));

-- ---------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------
create policy "payments: patient sees own, front desk sees all"
  on public.payments for select to authenticated
  using (
    (select private.is_front_desk())
    or exists (select 1 from public.reservations r
               where r.id = reservation_id and r.customer_id = (select private.my_customer_id()))
  );

-- Front desk records cash payments and refunds. Patients use submit_payment().
create policy "payments: front desk records"
  on public.payments for insert to authenticated
  with check ((select private.is_front_desk()));

-- Only front desk can verify/reject. Dentists and patients cannot.
create policy "payments: front desk verifies"
  on public.payments for update to authenticated
  using ((select private.is_front_desk()))
  with check ((select private.is_front_desk()));

-- ---------------------------------------------------------------------
-- Notifications: each person sees and marks read only their own.
-- ---------------------------------------------------------------------
create policy "notifications: read own"
  on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()));
create policy "notifications: mark own as read"
  on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Audit log: owner only. Nobody can insert, edit or delete through the
-- API — rows are written by the audit trigger.
-- ---------------------------------------------------------------------
create policy "audit: owner reads"
  on public.audit_logs for select to authenticated
  using ((select private.is_owner()));
