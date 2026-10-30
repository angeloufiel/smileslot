-- =====================================================================
-- Migration 2: helper functions and data-integrity triggers
--
-- Helpers are SECURITY DEFINER with an empty search_path so they can
-- read profiles/customers without being blocked by RLS, and so nobody
-- can hijack them by creating look-alike objects in another schema.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Who is calling?
-- ---------------------------------------------------------------------
create or replace function private.user_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select p.role from public.profiles p
  where p.id = (select auth.uid()) and p.is_active
$$;

create or replace function private.is_owner()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(private.user_role() = 'owner', false) $$;

-- Front desk = owner + secretary (full operational access)
create or replace function private.is_front_desk()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(private.user_role() in ('owner', 'secretary'), false) $$;

-- Staff = front desk + dentists
create or replace function private.is_staff()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(private.user_role() in ('owner', 'secretary', 'dentist'), false) $$;

-- The customer record that belongs to the logged-in patient (or NULL)
create or replace function private.my_customer_id()
returns uuid language sql stable security definer set search_path = ''
as $$ select c.id from public.customers c where c.profile_id = (select auth.uid()) $$;

-- The resource rows (dentist calendars) that belong to the logged-in dentist
create or replace function private.my_resource_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $$ select r.id from public.resources r where r.profile_id = (select auth.uid()) $$;

-- Customers a dentist has (or had) an appointment with
create or replace function private.my_patient_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select distinct res.customer_id
  from public.reservations res
  join public.resources r on r.id = res.resource_id
  where r.profile_id = (select auth.uid())
$$;

-- True when the statement comes straight from the API as a logged-in user
-- (not from one of our own SECURITY DEFINER functions, which run as the owner).
create or replace function private.is_direct_api_call()
returns boolean language sql stable
as $$ select current_user in ('authenticated', 'anon') $$;

revoke all on all functions in schema private from public;
grant usage on schema private to anon, authenticated, service_role;
grant execute on function
  private.user_role(), private.is_owner(), private.is_front_desk(), private.is_staff(),
  private.my_customer_id(), private.my_resource_ids(), private.my_patient_ids(),
  private.is_direct_api_call()
to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end $$;

create trigger trg_touch before update on public.clinic_settings for each row execute function private.touch_updated_at();
create trigger trg_touch before update on public.profiles        for each row execute function private.touch_updated_at();
create trigger trg_touch before update on public.services        for each row execute function private.touch_updated_at();
create trigger trg_touch before update on public.customers       for each row execute function private.touch_updated_at();
create trigger trg_touch before update on public.reservations    for each row execute function private.touch_updated_at();

-- Reject an invalid IANA timezone name in settings
create or replace function private.validate_settings()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'INVALID_TIMEZONE: %', new.timezone using errcode = '22023';
  end if;
  return new;
end $$;
create trigger trg_validate before insert or update on public.clinic_settings
  for each row execute function private.validate_settings();

-- ---------------------------------------------------------------------
-- Column guards: RLS decides WHICH ROWS you may update; these decide
-- WHICH COLUMNS. (RLS alone cannot stop a patient from setting
-- is_vip = true on their own customer row.)
-- ---------------------------------------------------------------------

-- profiles: a non-owner may only change their own name and phone.
create or replace function private.guard_profiles()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if private.is_direct_api_call() and not private.is_owner() then
    if new.role is distinct from old.role or new.is_active is distinct from old.is_active
       or new.id is distinct from old.id then
      raise exception 'FORBIDDEN: only the clinic owner can change roles or deactivate accounts'
        using errcode = '42501';
    end if;
  end if;
  -- Never leave the clinic without an active owner
  if old.role = 'owner' and (new.role <> 'owner' or not new.is_active)
     and (select count(*) from public.profiles where role = 'owner' and is_active and id <> old.id) = 0 then
    raise exception 'LAST_OWNER: the clinic must keep at least one active owner' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_guard before update on public.profiles
  for each row execute function private.guard_profiles();

-- customers: a patient may only change their own name and phone.
create or replace function private.guard_customers()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if private.is_direct_api_call() and not private.is_front_desk() then
    if (to_jsonb(new) - 'full_name' - 'phone' - 'updated_at')
       is distinct from (to_jsonb(old) - 'full_name' - 'phone' - 'updated_at') then
      raise exception 'FORBIDDEN: patients may only update their name and phone' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger trg_guard before update on public.customers
  for each row execute function private.guard_customers();

-- notifications: recipients may only mark them read.
create or replace function private.guard_notifications()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if private.is_direct_api_call()
     and (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception 'FORBIDDEN: notifications can only be marked as read' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_guard before update on public.notifications
  for each row execute function private.guard_notifications();

-- ---------------------------------------------------------------------
-- Reservations: derive times, validate dentist, enforce status flow
-- ---------------------------------------------------------------------
create or replace function private.reservation_before_write()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_service public.services%rowtype;
begin
  -- Recalculate end time whenever the start or the service changes.
  if tg_op = 'INSERT' or new.starts_at is distinct from old.starts_at
     or new.service_id is distinct from old.service_id then
    select * into v_service from public.services where id = new.service_id;
    if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = '23503'; end if;
    new.ends_at       := new.starts_at + make_interval(mins => v_service.duration_minutes);
    new.blocked_until := new.ends_at   + make_interval(mins => v_service.buffer_minutes);
  end if;

  -- The assigned dentist must actually offer the service.
  if tg_op = 'INSERT' or new.resource_id is distinct from old.resource_id
     or new.service_id is distinct from old.service_id then
    if not exists (select 1 from public.service_resources
                   where service_id = new.service_id and resource_id = new.resource_id) then
      raise exception 'RESOURCE_CANNOT_PERFORM_SERVICE' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    -- Allowed status transitions. Anything else is a bug or an attack.
    if not (
         (old.status = 'pending'     and new.status in ('confirmed', 'rejected', 'cancelled', 'expired'))
      or (old.status = 'confirmed'   and new.status in ('checked_in', 'cancelled', 'no_show'))
      or (old.status = 'checked_in'  and new.status in ('in_progress', 'completed'))
      or (old.status = 'in_progress' and new.status = 'completed')
    ) then
      raise exception 'INVALID_STATUS_TRANSITION: % -> %', old.status, new.status using errcode = '23514';
    end if;
    if new.status <> 'pending' then new.expires_at := null; end if;
  end if;

  -- Dentists (direct API calls) may only move their own appointments
  -- through the chair-side statuses. They cannot touch price, time, patient…
  if tg_op = 'UPDATE' and private.is_direct_api_call() and not private.is_front_desk() then
    if (to_jsonb(new) - 'status' - 'updated_at' - 'expires_at')
       is distinct from (to_jsonb(old) - 'status' - 'updated_at' - 'expires_at') then
      raise exception 'FORBIDDEN: dentists can only update appointment status' using errcode = '42501';
    end if;
    if new.status not in ('checked_in', 'in_progress', 'completed', 'no_show') then
      raise exception 'FORBIDDEN: dentists cannot set status %', new.status using errcode = '42501';
    end if;
  end if;

  return new;
end $$;
create trigger trg_before_write before insert or update on public.reservations
  for each row execute function private.reservation_before_write();

-- Status history (written by the system, never by users directly)
create or replace function private.reservation_history()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.reservation_status_history (reservation_id, from_status, to_status, changed_by, reason)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status,
            (select auth.uid()), new.status_reason);
  end if;
  return null;
end $$;
create trigger trg_history after insert or update of status on public.reservations
  for each row execute function private.reservation_history();

-- ---------------------------------------------------------------------
-- Payments: who verified, allowed status flow, keep reservation totals
-- ---------------------------------------------------------------------
create or replace function private.payment_before_write()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status in ('verified', 'rejected', 'failed') and new.status is distinct from old.status then
      raise exception 'PAYMENT_FINALIZED: record a refund instead of changing a % payment', old.status
        using errcode = '23514';
    end if;
    if (to_jsonb(new) - 'status' - 'rejection_reason' - 'verified_by' - 'verified_at')
       is distinct from (to_jsonb(old) - 'status' - 'rejection_reason' - 'verified_by' - 'verified_at') then
      raise exception 'FORBIDDEN: only the verification fields of a payment can change' using errcode = '42501';
    end if;
    -- These are system-stamped; ignore any value sent by the client.
    new.verified_by := old.verified_by;
    new.verified_at := old.verified_at;
  end if;

  -- Stamp who verified it. Users cannot fake this column.
  if new.status in ('verified', 'rejected')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.verified_by := (select auth.uid());
    new.verified_at := now();
  elsif tg_op = 'INSERT' then
    new.verified_by := null;
    new.verified_at := null;
  end if;

  if tg_op = 'INSERT' and new.submitted_by is null then
    new.submitted_by := (select auth.uid());
  end if;
  return new;
end $$;
create trigger trg_before_write before insert or update on public.payments
  for each row execute function private.payment_before_write();

create or replace function private.refresh_reservation_payment(p_reservation_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_res      public.reservations%rowtype;
  v_paid     numeric(10,2);
  v_refunded numeric(10,2);
  v_net      numeric(10,2);
  v_pending  boolean;
  v_failed   boolean;
  v_status   public.payment_status;
  v_approval boolean;
begin
  select * into v_res from public.reservations where id = p_reservation_id for update;

  select coalesce(sum(amount) filter (where kind = 'payment' and status = 'verified'), 0),
         coalesce(sum(amount) filter (where kind = 'refund'  and status = 'verified'), 0),
         coalesce(bool_or(status = 'awaiting_verification'), false),
         coalesce(bool_or(status = 'failed'), false)
    into v_paid, v_refunded, v_pending, v_failed
  from public.payments where reservation_id = p_reservation_id;

  v_net := v_paid - v_refunded;
  v_status := case
    when v_refunded > 0 and v_net <= 0           then 'refunded'
    when v_net >= v_res.price and v_net > 0       then 'paid'
    when v_net > 0                                then 'partially_paid'
    when v_pending                                then 'awaiting_verification'
    when v_failed                                 then 'failed'
    else 'unpaid'
  end;

  update public.reservations
     set amount_paid = v_net, payment_status = v_status
   where id = p_reservation_id;

  -- Verified deposit on a pending booking: confirm it automatically,
  -- unless the service needs manual approval (then just stop the expiry clock).
  if v_res.status = 'pending' and v_res.deposit_required > 0 and v_net >= v_res.deposit_required then
    select requires_approval into v_approval from public.services where id = v_res.service_id;
    if v_approval then
      update public.reservations set expires_at = null where id = p_reservation_id;
    else
      update public.reservations
         set status = 'confirmed', status_reason = 'Deposit verified'
       where id = p_reservation_id;
    end if;
  end if;
end $$;

create or replace function private.payment_after_write()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform private.refresh_reservation_payment(new.reservation_id);
  return null;
end $$;
create trigger trg_after_write after insert or update on public.payments
  for each row execute function private.payment_after_write();

-- ---------------------------------------------------------------------
-- New login → profile. Confirmed email → link earlier guest bookings.
-- ---------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  -- Role is ALWAYS 'patient' on signup. Never trust a role sent from the browser.
  insert into public.profiles (id, full_name, phone)
  values (new.id,
          left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120),
          left(new.raw_user_meta_data ->> 'phone', 30))
  on conflict (id) do nothing;
  return new;
end $$;
-- Trigger names are prefixed 10_ / 20_ because Postgres fires same-event triggers
-- in ALPHABETICAL order: the profile must exist before the email-confirmed handler runs.
create trigger on_auth_user_10_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Link guest bookings to the new account ONLY after the email is confirmed.
-- Otherwise anyone could sign up with someone else's email and see their bookings.
create or replace function private.handle_email_confirmed()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null
     and (tg_op = 'INSERT' or old.email_confirmed_at is null) then
    update public.customers
       set profile_id = new.id
     where lower(email) = lower(new.email) and profile_id is null;

    if not found and not exists (select 1 from public.customers where profile_id = new.id) then
      insert into public.customers (profile_id, full_name, email, phone)
      select p.id, coalesce(nullif(p.full_name, ''), split_part(new.email, '@', 1)), new.email, p.phone
      from public.profiles p where p.id = new.id
      on conflict do nothing;
    end if;
  end if;
  return new;
end $$;
create trigger on_auth_user_20_confirmed after insert or update of email_confirmed_at on auth.users
  for each row execute function private.handle_email_confirmed();

-- ---------------------------------------------------------------------
-- Notifications (in-app). Emails are sent by the Next.js app.
-- ---------------------------------------------------------------------
create or replace function private.notify_front_desk(p_type text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = ''
as $$
  insert into public.notifications (recipient_id, type, title, body, link)
  select id, p_type, p_title, p_body, p_link
  from public.profiles where role in ('owner', 'secretary') and is_active
$$;

create or replace function private.reservation_notify()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_profile uuid;
begin
  select profile_id into v_profile from public.customers where id = new.customer_id;

  if tg_op = 'INSERT' then
    perform private.notify_front_desk('reservation.new', 'New reservation ' || new.reference_code,
      new.contact_name || ' booked for ' ||
      to_char(new.starts_at at time zone coalesce(
                (select timezone from public.clinic_settings where id = 1), 'Asia/Manila'),
              'Mon DD, YYYY HH12:MI AM'),
      '/dashboard/reservations/' || new.id);
  elsif new.status is distinct from old.status then
    if v_profile is not null then
      insert into public.notifications (recipient_id, type, title, body, link)
      values (v_profile, 'reservation.' || new.status,
              'Booking ' || new.reference_code || ' is now ' || replace(new.status::text, '_', ' '),
              new.status_reason, '/my/bookings/' || new.reference_code);
    end if;
    if new.status = 'cancelled' then
      perform private.notify_front_desk('reservation.cancelled', 'Cancelled: ' || new.reference_code,
        new.status_reason, '/dashboard/reservations/' || new.id);
    end if;
  end if;
  return null;
end $$;
create trigger trg_notify after insert or update of status on public.reservations
  for each row execute function private.reservation_notify();

create or replace function private.payment_notify()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_ref text;
begin
  if new.status = 'awaiting_verification' then
    select reference_code into v_ref from public.reservations where id = new.reservation_id;
    perform private.notify_front_desk('payment.submitted', 'Payment to verify: ' || v_ref,
      case new.method when 'gcash' then 'GCash' when 'maya' then 'Maya' when 'bank_transfer' then 'Bank transfer'
        else initcap(new.method::text) end || ' ₱' || to_char(new.amount, 'FM999,999,990.00'),
      '/dashboard/payments?status=awaiting_verification');
  end if;
  return null;
end $$;
create trigger trg_notify after insert on public.payments
  for each row execute function private.payment_notify();

-- ---------------------------------------------------------------------
-- Audit log: every change to sensitive tables, with who did it.
-- ---------------------------------------------------------------------
create or replace function private.audit()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_logs (actor_id, action, table_name, record_id, old_data, new_data)
  values ((select auth.uid()), tg_op, tg_table_name,
          coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id'),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

create trigger trg_audit after insert or update or delete on public.reservations    for each row execute function private.audit();
create trigger trg_audit after insert or update or delete on public.payments        for each row execute function private.audit();
create trigger trg_audit after insert or update or delete on public.customers       for each row execute function private.audit();
create trigger trg_audit after insert or update or delete on public.services        for each row execute function private.audit();
create trigger trg_audit after insert or update or delete on public.resources       for each row execute function private.audit();
create trigger trg_audit after insert or update or delete on public.clinic_settings for each row execute function private.audit();
create trigger trg_audit after update or delete           on public.profiles        for each row execute function private.audit();
