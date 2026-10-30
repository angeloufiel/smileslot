-- =====================================================================
-- Migration 3: booking engine (the public API for patients and guests)
--
-- Patients and guests NEVER insert into reservations directly. They call
-- these functions, which validate everything server-side. The functions
-- return only safe fields — never another patient's data.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Expire unpaid pending bookings so their slots open up again.
-- A booking with a payment awaiting verification is NOT expired.
-- ---------------------------------------------------------------------
create or replace function private.expire_pending_reservations()
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  update public.reservations r
     set status = 'expired', status_reason = 'Deposit not received in time'
   where r.status = 'pending'
     and r.expires_at is not null
     and r.expires_at < now()
     and not exists (select 1 from public.payments p
                     where p.reservation_id = r.id and p.status = 'awaiting_verification');
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- Available slots for one service on one clinic-local date.
--
-- A slot is offered only if ALL of these hold:
--   1. the dentist offers the service and is active
--   2. the slot fits inside one of the dentist's working-hour blocks
--   3. the clinic is not closed that day
--   4. the dentist has no time off overlapping the slot
--   5. no active reservation overlaps [start, start + duration + buffer)
--   6. it respects minimum notice and maximum advance booking
-- ---------------------------------------------------------------------
create or replace function public.get_available_slots(
  p_service_id  uuid,
  p_date        date,
  p_resource_id uuid default null
)
returns table (resource_id uuid, resource_name text, slot_start timestamptz, slot_end timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cfg public.clinic_settings%rowtype;
  v_svc public.services%rowtype;
  v_today date;
begin
  select * into v_cfg from public.clinic_settings where id = 1;
  select * into v_svc from public.services where id = p_service_id and is_active;
  if v_svc.id is null or v_cfg.id is null then return; end if;

  v_today := (now() at time zone v_cfg.timezone)::date;
  if p_date < v_today or p_date > v_today + v_cfg.max_advance_days then return; end if;
  if exists (select 1 from public.clinic_closures where closed_on = p_date) then return; end if;

  return query
  with candidates as (
    select distinct r.id as rid, r.name as rname,
           (gs at time zone v_cfg.timezone) as s_start
    from public.resources r
    join public.service_resources sr on sr.resource_id = r.id and sr.service_id = v_svc.id
    join public.working_hours wh     on wh.resource_id = r.id
                                    and wh.weekday = extract(dow from p_date)::smallint
    cross join lateral generate_series(
      p_date + wh.start_time,
      p_date + wh.end_time - make_interval(mins => v_svc.duration_minutes),
      make_interval(mins => v_cfg.slot_interval_minutes)
    ) as gs
    where r.is_active
      and (p_resource_id is null or r.id = p_resource_id)
  )
  select c.rid, c.rname, c.s_start,
         c.s_start + make_interval(mins => v_svc.duration_minutes)
  from candidates c
  where c.s_start >= now() + make_interval(mins => v_cfg.min_notice_minutes)
    and not exists (
      select 1 from public.reservations x
      where x.resource_id = c.rid
        and x.status in ('pending', 'confirmed', 'checked_in', 'in_progress', 'completed')
        and not (x.status = 'pending' and x.expires_at is not null and x.expires_at < now())
        and tstzrange(x.starts_at, x.blocked_until, '[)')
         && tstzrange(c.s_start, c.s_start + make_interval(mins => v_svc.duration_minutes + v_svc.buffer_minutes), '[)')
    )
    and not exists (
      select 1 from public.resource_time_off t
      where t.resource_id = c.rid
        and t.period && tstzrange(c.s_start, c.s_start + make_interval(mins => v_svc.duration_minutes), '[)')
    )
  order by c.s_start, c.rname;
end $$;

-- ---------------------------------------------------------------------
-- Unambiguous reference codes: SS-XXXXXXXX (no 0/O/1/I/L).
-- 31^8 ≈ 850 billion combinations, so guessing one is impractical,
-- and lookups also require the matching email.
-- ---------------------------------------------------------------------
create or replace function private.new_reference_code()
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_code  text;
begin
  loop
    v_bytes := extensions.gen_random_bytes(8);
    v_code := 'SS-';
    for i in 0..7 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 31) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.reservations where reference_code = v_code);
  end loop;
  return v_code;
end $$;

-- Staff inserts (walk-ins, phone bookings) get a code automatically.
alter table public.reservations alter column reference_code set default private.new_reference_code();

-- ---------------------------------------------------------------------
-- Book an appointment (guests and logged-in patients).
-- ---------------------------------------------------------------------
create or replace function public.book_appointment(
  p_service_id  uuid,
  p_starts_at   timestamptz,
  p_full_name   text,
  p_email       text,
  p_phone       text,
  p_resource_id uuid default null,
  p_notes       text default null
)
returns table (reference_code text, status public.reservation_status, starts_at timestamptz,
               resource_name text, price numeric, deposit_required numeric, expires_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_cfg      public.clinic_settings%rowtype;
  v_svc      public.services%rowtype;
  v_uid      uuid := (select auth.uid());
  v_role     public.app_role := private.user_role();
  v_name     text := btrim(coalesce(p_full_name, ''));
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_phone    text := btrim(coalesce(p_phone, ''));
  v_resource uuid;
  v_rname    text;
  v_customer uuid;
  v_status   public.reservation_status;
  v_expires  timestamptz;
  v_ref      text;
begin
  -- 1. Validate input (never trust the browser)
  if char_length(v_name) not between 2 and 120 then
    raise exception 'INVALID_NAME' using errcode = '22023'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'INVALID_EMAIL' using errcode = '22023'; end if;
  if v_phone !~ '^\+?[0-9 ()-]{7,20}$' then
    raise exception 'INVALID_PHONE' using errcode = '22023'; end if;
  if char_length(coalesce(p_notes, '')) > 1000 then
    raise exception 'NOTES_TOO_LONG' using errcode = '22023'; end if;
  if v_role is not null and v_role <> 'patient' then
    raise exception 'STAFF_USE_DASHBOARD: staff create bookings from the dashboard' using errcode = '42501';
  end if;

  select * into v_cfg from public.clinic_settings where id = 1;
  select * into v_svc from public.services where id = p_service_id and is_active;
  if v_svc.id is null then raise exception 'SERVICE_NOT_FOUND' using errcode = '22023'; end if;

  -- 2. Free slots held by expired unpaid bookings
  perform private.expire_pending_reservations();

  -- 3. The requested time must be a slot the engine would actually offer
  select s.resource_id, s.resource_name into v_resource, v_rname
  from public.get_available_slots(p_service_id, (p_starts_at at time zone v_cfg.timezone)::date, p_resource_id) s
  where s.slot_start = p_starts_at
  order by s.resource_name
  limit 1;
  if v_resource is null then raise exception 'SLOT_UNAVAILABLE' using errcode = 'P0001'; end if;

  -- 4. Find or create the customer record
  if v_uid is not null then
    v_customer := private.my_customer_id();
    if v_customer is null then
      raise exception 'CONFIRM_EMAIL_FIRST: please confirm your email address before booking' using errcode = '42501';
    end if;
    -- Logged-in patients always book under their own verified email.
    select lower(c.email) into v_email from public.customers c where c.id = v_customer;
  else
    select id into v_customer from public.customers where lower(email) = v_email;
    if v_customer is null then
      insert into public.customers (full_name, email, phone)
      values (v_name, v_email, v_phone)
      returning id into v_customer;
    end if;
    -- An existing customer's saved name/phone is never overwritten by a guest form.
  end if;

  -- 5. Decide the initial status
  if v_svc.deposit_amount > 0 then
    v_status  := 'pending';
    v_expires := now() + make_interval(mins => v_cfg.pending_expiry_minutes);
  elsif v_svc.requires_approval or not v_cfg.auto_confirm then
    v_status  := 'pending';
    v_expires := null;  -- waits for staff approval, does not expire on its own
  else
    v_status  := 'confirmed';
  end if;

  v_ref := private.new_reference_code();

  -- 6. Insert. If another request grabbed the slot a millisecond ago,
  --    the exclusion constraint rejects this insert.
  begin
    insert into public.reservations (
      reference_code, customer_id, service_id, resource_id, starts_at, ends_at, blocked_until,
      status, source, contact_name, contact_email, contact_phone, patient_notes,
      price, deposit_required, expires_at, created_by
    ) values (
      v_ref, v_customer, v_svc.id, v_resource, p_starts_at, p_starts_at, p_starts_at,  -- end times set by trigger
      v_status, 'online', v_name, v_email, v_phone, nullif(btrim(p_notes), ''),
      v_svc.price, v_svc.deposit_amount, v_expires, v_uid
    );
  exception when exclusion_violation then
    raise exception 'SLOT_UNAVAILABLE' using errcode = 'P0001';
  end;

  return query select v_ref, v_status, p_starts_at, v_rname, v_svc.price, v_svc.deposit_amount, v_expires;
end $$;

-- ---------------------------------------------------------------------
-- Track a booking: reference code + email must BOTH match.
-- ---------------------------------------------------------------------
create or replace function public.get_booking(p_reference text, p_email text)
returns table (reference_code text, status public.reservation_status, service_name text,
               dentist_name text, starts_at timestamptz, ends_at timestamptz,
               price numeric, deposit_required numeric, amount_paid numeric,
               payment_status public.payment_status, expires_at timestamptz, can_cancel boolean)
language sql stable security definer set search_path = ''
as $$
  select r.reference_code, r.status, s.name, d.name, r.starts_at, r.ends_at,
         r.price, r.deposit_required, r.amount_paid, r.payment_status, r.expires_at,
         (r.status in ('pending', 'confirmed')
          and r.starts_at - now() >= make_interval(hours => c.cancellation_cutoff_hours))
  from public.reservations r
  join public.services  s on s.id = r.service_id
  join public.resources d on d.id = r.resource_id
  cross join public.clinic_settings c
  where r.reference_code = upper(btrim(p_reference))
    and lower(r.contact_email) = lower(btrim(p_email))
$$;

-- ---------------------------------------------------------------------
-- Patient / guest cancellation, respecting the cancellation cut-off.
-- ---------------------------------------------------------------------
create or replace function public.cancel_booking(p_reference text, p_email text, p_reason text default null)
returns public.reservation_status
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_res    public.reservations%rowtype;
  v_cutoff int;
begin
  select * into v_res from public.reservations
  where reference_code = upper(btrim(p_reference))
    and lower(contact_email) = lower(btrim(p_email))
  for update;
  if v_res.id is null then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_res.status not in ('pending', 'confirmed') then
    raise exception 'CANNOT_CANCEL_STATUS: booking is %', v_res.status using errcode = '23514';
  end if;

  select cancellation_cutoff_hours into v_cutoff from public.clinic_settings where id = 1;
  if v_res.starts_at - now() < make_interval(hours => v_cutoff) then
    raise exception 'CANCELLATION_WINDOW_PASSED: please call the clinic to cancel' using errcode = '23514';
  end if;

  update public.reservations
     set status = 'cancelled',
         status_reason = coalesce(left(nullif(btrim(p_reason), ''), 500), 'Cancelled by patient')
   where id = v_res.id;
  return 'cancelled';
end $$;

-- ---------------------------------------------------------------------
-- Patient / guest submits a GCash, Maya or bank transfer payment.
-- It is ALWAYS created as 'awaiting_verification'. Only front-desk
-- staff can mark it verified (see RLS on payments).
-- ---------------------------------------------------------------------
create or replace function public.submit_payment(
  p_reference    text,
  p_email        text,
  p_method       public.payment_method,
  p_amount       numeric,
  p_reference_no text,
  p_proof_path   text default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_res     public.reservations%rowtype;
  v_pending numeric;
  v_id      uuid;
begin
  if p_method not in ('gcash', 'maya', 'bank_transfer') then
    raise exception 'INVALID_METHOD: online submissions accept GCash, Maya or bank transfer' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reference_no, ''))) not between 4 and 100 then
    raise exception 'INVALID_REFERENCE_NO' using errcode = '22023';
  end if;
  -- Proof files must sit in this booking's own folder: payment-proofs/<reference>/...
  if p_proof_path is not null and p_proof_path !~ ('^' || upper(btrim(p_reference)) || '/[A-Za-z0-9._-]+$') then
    raise exception 'INVALID_PROOF_PATH' using errcode = '22023';
  end if;

  select * into v_res from public.reservations
  where reference_code = upper(btrim(p_reference))
    and lower(contact_email) = lower(btrim(p_email))
  for update;
  if v_res.id is null then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_res.status not in ('pending', 'confirmed') then
    raise exception 'CANNOT_PAY_STATUS: booking is %', v_res.status using errcode = '23514';
  end if;

  select coalesce(sum(amount), 0) into v_pending
  from public.payments where reservation_id = v_res.id and status = 'awaiting_verification';

  if p_amount is null or p_amount <= 0 or p_amount > v_res.price - v_res.amount_paid - v_pending then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;

  insert into public.payments (reservation_id, kind, method, amount, status, reference_no, proof_path)
  values (v_res.id, 'payment', p_method, round(p_amount, 2), 'awaiting_verification',
          btrim(p_reference_no), p_proof_path)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Function permissions: by default Postgres lets PUBLIC execute any
-- function. Lock that down and grant exactly what each role needs.
-- ---------------------------------------------------------------------
revoke all on function private.expire_pending_reservations() from public;
revoke all on function private.new_reference_code()          from public;
revoke all on function private.refresh_reservation_payment(uuid) from public;
revoke all on function private.notify_front_desk(text, text, text, text) from public;

revoke all on function public.get_available_slots(uuid, date, uuid) from public;
revoke all on function public.book_appointment(uuid, timestamptz, text, text, text, uuid, text) from public;
revoke all on function public.get_booking(text, text) from public;
revoke all on function public.cancel_booking(text, text, text) from public;
revoke all on function public.submit_payment(text, text, public.payment_method, numeric, text, text) from public;

grant execute on function public.get_available_slots(uuid, date, uuid) to anon, authenticated;
grant execute on function public.book_appointment(uuid, timestamptz, text, text, text, uuid, text) to anon, authenticated;
grant execute on function public.get_booking(text, text) to anon, authenticated;
grant execute on function public.cancel_booking(text, text, text) to anon, authenticated;
grant execute on function public.submit_payment(text, text, public.payment_method, numeric, text, text) to anon, authenticated, service_role;
grant execute on function private.expire_pending_reservations() to service_role;
grant execute on function private.new_reference_code() to authenticated, service_role;  -- used by the column default

-- ---------------------------------------------------------------------
-- Scheduled expiry every 5 minutes (Supabase: pg_cron).
-- Skipped automatically where pg_cron is not available.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    execute $c$select cron.schedule('expire-pending-reservations', '*/5 * * * *',
                                    'select private.expire_pending_reservations()')$c$;
  end if;
end $$;
