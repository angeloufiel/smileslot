-- =====================================================================
-- Migration 6: friendlier booking numbers, quick closures, notification
-- clean-up.
--
--  1. Booking numbers become 8 digits (shown as 4827-3159) instead of
--     SS-7K4MQ2XP: easy to read aloud and type, like a GCash reference.
--     Lookups still need the matching email, so a number alone reveals nothing.
--  2. Dentists can close their own time (urgent meeting, emergency) and
--     reopen it; the front desk can do it for any dentist.
--  3. Staff can delete their own notifications.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Booking numbers
-- ---------------------------------------------------------------------

-- 8 random digits, never starting with 0 (so it can't lose a digit in a spreadsheet).
-- 90 million combinations; get_booking() also requires the email.
create or replace function private.new_reference_code()
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_bytes bytea;
  v_code  text;
begin
  loop
    v_bytes := extensions.gen_random_bytes(8);
    v_code := ((get_byte(v_bytes, 0) % 9) + 1)::text;
    for i in 1..7 loop
      v_code := v_code || (get_byte(v_bytes, i) % 10)::text;
    end loop;
    exit when not exists (select 1 from public.reservations where reference_code = v_code);
  end loop;
  return v_code;
end $$;

-- What patients type can include spaces or dashes ("4827 3159", "4827-3159"). Keep digits only.
create or replace function private.normalize_ref(p_reference text)
returns text language sql immutable set search_path = ''
as $$ select regexp_replace(coalesce(p_reference, ''), '[^0-9]', '', 'g') $$;

-- How a booking number is shown to people: 4827-3159
create or replace function private.format_ref(p_reference text)
returns text language sql immutable set search_path = ''
as $$
  select case when p_reference ~ '^[0-9]{8}$'
              then substr(p_reference, 1, 4) || '-' || substr(p_reference, 5, 4)
              else p_reference end
$$;

revoke all on function private.normalize_ref(text) from public;
revoke all on function private.format_ref(text) from public;
grant execute on function private.normalize_ref(text), private.format_ref(text) to anon, authenticated, service_role;

-- Give existing bookings (old SS- codes) a new booking number.
update public.reservations
   set reference_code = private.new_reference_code()
 where reference_code !~ '^[0-9]{8}$';

alter table public.reservations
  add constraint reservations_reference_format check (reference_code ~ '^[0-9]{8}$');

-- Tracking, cancelling and paying accept the number with or without dashes/spaces.
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
  where r.reference_code = private.normalize_ref(p_reference)
    and lower(r.contact_email) = lower(btrim(p_email))
$$;

create or replace function public.cancel_booking(p_reference text, p_email text, p_reason text default null)
returns public.reservation_status
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_res    public.reservations%rowtype;
  v_cutoff int;
begin
  select * into v_res from public.reservations
  where reference_code = private.normalize_ref(p_reference)
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
  v_ref     text := private.normalize_ref(p_reference);
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
  -- Proof files must sit in this booking's own folder: payment-proofs/<booking number>/...
  if p_proof_path is not null and p_proof_path !~ ('^' || v_ref || '/[A-Za-z0-9._-]+$') then
    raise exception 'INVALID_PROOF_PATH' using errcode = '22023';
  end if;

  select * into v_res from public.reservations
  where reference_code = v_ref
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

-- Notifications show the friendly number (and the patient link now points to a real page).
create or replace function private.reservation_notify()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_profile uuid;
  v_ref text := private.format_ref(new.reference_code);
begin
  select profile_id into v_profile from public.customers where id = new.customer_id;

  if tg_op = 'INSERT' then
    perform private.notify_front_desk('reservation.new', 'New booking ' || v_ref,
      new.contact_name || ' booked for ' ||
      to_char(new.starts_at at time zone coalesce(
                (select timezone from public.clinic_settings where id = 1), 'Asia/Manila'),
              'Mon DD, YYYY HH12:MI AM'),
      '/dashboard/reservations/' || new.id);
  elsif new.status is distinct from old.status then
    if v_profile is not null then
      insert into public.notifications (recipient_id, type, title, body, link)
      values (v_profile, 'reservation.' || new.status,
              'Booking ' || v_ref || ' is now ' || replace(new.status::text, '_', ' '),
              new.status_reason, '/my/bookings');
    end if;
    if new.status = 'cancelled' then
      perform private.notify_front_desk('reservation.cancelled', 'Cancelled: booking ' || v_ref,
        coalesce(new.status_reason, new.contact_name || ' cancelled'), '/dashboard/reservations/' || new.id);
    end if;
  end if;
  return null;
end $$;

create or replace function private.payment_notify()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_ref text;
begin
  if new.status = 'awaiting_verification' then
    select private.format_ref(reference_code) into v_ref from public.reservations where id = new.reservation_id;
    perform private.notify_front_desk('payment.submitted', 'Payment to verify: booking ' || v_ref,
      case new.method when 'gcash' then 'GCash' when 'maya' then 'Maya' when 'bank_transfer' then 'Bank transfer'
        else initcap(new.method::text) end || ' ₱' || to_char(new.amount, 'FM999,999,990.00'),
      '/dashboard/payments');
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 2. Quick closures (time off) by the dentist themself
-- ---------------------------------------------------------------------
alter table public.resource_time_off
  add column if not exists created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  add column if not exists created_at timestamptz not null default now();

create policy "time_off: dentist closes own time"
  on public.resource_time_off for insert to authenticated
  with check (resource_id in (select private.my_resource_ids()));

create policy "time_off: dentist reopens own time"
  on public.resource_time_off for delete to authenticated
  using (resource_id in (select private.my_resource_ids()));

create trigger trg_audit after insert or update or delete on public.resource_time_off
  for each row execute function private.audit();

-- ---------------------------------------------------------------------
-- 3. Delete own notifications
-- ---------------------------------------------------------------------
grant delete on public.notifications to authenticated;

create policy "notifications: delete own"
  on public.notifications for delete to authenticated
  using (recipient_id = (select auth.uid()));
