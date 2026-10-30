-- =====================================================================
-- Migration 7: clinic logo, instant sign-up (no email verification)
--
-- 1. clinic_settings.logo_url + a PUBLIC "branding" bucket for the logo.
--    Uploads happen on the server (owner only) with the service role.
-- 2. Patients can sign in right after creating an account. Because the
--    email is no longer proven, a new account must NOT be linked to the
--    guest bookings made with that email. Instead:
--      * guests and accounts get separate customer records
--        (email unique among GUEST records only),
--      * a patient adds an old guest booking to their account with
--        claim_booking(booking number). Only someone who received the
--        booking number AND signed up with the same email can do that.
-- =====================================================================

-- 1. Logo ---------------------------------------------------------------
alter table public.clinic_settings
  add column if not exists logo_url text check (char_length(logo_url) <= 500);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 1048576, array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
-- No storage policies on purpose: the browser never writes to this bucket.

-- 2. Separate guest and account customer records -----------------------
drop index if exists public.customers_email_key;
create unique index if not exists customers_guest_email_key
  on public.customers (lower(email)) where profile_id is null;

-- New account → its own customer record. Never adopt an existing guest record.
create or replace function private.handle_email_confirmed()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null
     and (tg_op = 'INSERT' or old.email_confirmed_at is null)
     and not exists (select 1 from public.customers where profile_id = new.id) then
    insert into public.customers (profile_id, full_name, email, phone)
    select p.id, coalesce(nullif(p.full_name, ''), split_part(new.email, '@', 1)), new.email, p.phone
    from public.profiles p where p.id = new.id;
  end if;
  return new;
end $$;

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
      raise exception 'CONFIRM_EMAIL_FIRST: your account is not ready yet, please sign out and in again' using errcode = '42501';
    end if;
    -- Logged-in patients always book under their own verified email.
    select lower(c.email) into v_email from public.customers c where c.id = v_customer;
  else
    -- Guests always use the GUEST record for this email, never an account's record:
    -- typing someone's email must not put a booking into their account (or theirs into yours).
    select id into v_customer from public.customers where lower(email) = v_email and profile_id is null;
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


revoke all on function public.book_appointment(uuid, timestamptz, text, text, text, uuid, text) from public;
grant execute on function public.book_appointment(uuid, timestamptz, text, text, text, uuid, text) to anon, authenticated;

-- A signed-in patient adds a booking they made as a guest.
-- Proof of ownership: the booking number (sent to that email) + the account has the same email.
create or replace function public.claim_booking(p_reference text)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_mine  uuid := private.my_customer_id();
  v_email text;
  v_res   uuid;
  v_ref   text := private.normalize_ref(p_reference);
begin
  if v_mine is null then
    raise exception 'NOT_A_PATIENT: sign in with a patient account' using errcode = '42501';
  end if;
  select lower(email) into v_email from public.customers where id = v_mine;

  select r.id into v_res
  from public.reservations r
  join public.customers c on c.id = r.customer_id
  where r.reference_code = v_ref
    and lower(r.contact_email) = v_email
    and c.profile_id is null;          -- only guest bookings; never another account's
  if v_res is null then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.reservations set customer_id = v_mine where id = v_res;
  return v_ref;
end $$;
revoke all on function public.claim_booking(text) from public;
grant execute on function public.claim_booking(text) to authenticated;
