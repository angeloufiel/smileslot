-- =====================================================================
-- SmileSlot database tests: try to break booking rules and RLS.
-- Run with:  ./tests/db/run.sh
-- Every check prints "PASS: ..." or stops with "FAIL: ...".
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- ---------- tiny test framework ----------
create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

create or replace function tests.ok(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'FAIL: %', p_name; end if;
  raise notice 'PASS: %', p_name;
end $$;

-- Runs p_sql as the CURRENT role and expects an error whose message matches p_pattern.
create or replace function tests.throws(p_sql text, p_pattern text, p_name text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_pattern || '%' then
      raise notice 'PASS: % (blocked: %)', p_name, left(sqlerrm, 70);
      return;
    end if;
    raise exception 'FAIL: % — wrong error: %', p_name, sqlerrm;
  end;
  raise exception 'FAIL: % — statement succeeded but should have been blocked', p_name;
end $$;

-- Counts rows visible to the CURRENT role.
create or replace function tests.visible(p_sql text) returns bigint
language plpgsql as $$
declare n bigint;
begin execute 'select count(*) from (' || p_sql || ') q' into n; return n; end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ---------- users ----------
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000001', 'owner@test.local',      now(), '{"full_name":"Olivia Owner"}'),
  ('a0000000-0000-4000-8000-000000000002', 'desk@test.local',       now(), '{"full_name":"Rhea Reception"}'),
  ('a0000000-0000-4000-8000-000000000003', 'ana@test.local',        now(), '{"full_name":"Dr Ana"}'),
  ('a0000000-0000-4000-8000-000000000004', 'marco@test.local',      now(), '{"full_name":"Dr Marco"}'),
  ('a0000000-0000-4000-8000-000000000005', 'pat.a@test.local',      now(), '{"full_name":"Patient A","role":"owner"}'),
  ('a0000000-0000-4000-8000-000000000006', 'pat.b@test.local',      now(), '{"full_name":"Patient B"}');

-- Promote staff (as the database admin, like a seed script would)
update public.profiles set role = 'owner'        where id = 'a0000000-0000-4000-8000-000000000001';
update public.profiles set role = 'secretary' where id = 'a0000000-0000-4000-8000-000000000002';
update public.profiles set role = 'dentist'      where id in ('a0000000-0000-4000-8000-000000000003',
                                                              'a0000000-0000-4000-8000-000000000004');
update public.resources set profile_id = 'a0000000-0000-4000-8000-000000000003'
 where id = '30000000-0000-4000-8000-000000000001';
update public.resources set profile_id = 'a0000000-0000-4000-8000-000000000004'
 where id = '30000000-0000-4000-8000-000000000002';

select tests.ok((select role from public.profiles where id = 'a0000000-0000-4000-8000-000000000005') = 'patient',
  'signup ignores a "role":"owner" sent in user metadata');

-- Next Tuesday at least 3 days away (both dentists work Tuesdays)
select (current_date + ((2 - extract(dow from current_date)::int + 7) % 7)
        + case when ((2 - extract(dow from current_date)::int + 7) % 7) < 3 then 7 else 0 end) as d \gset
\echo Test date: :d

select ((:'d'::date + time '09:00') at time zone 'Asia/Manila') as t0900,
       ((:'d'::date + time '09:15') at time zone 'Asia/Manila') as t0915,
       ((:'d'::date + time '09:30') at time zone 'Asia/Manila') as t0930,
       ((:'d'::date + time '09:45') at time zone 'Asia/Manila') as t0945,
       ((:'d'::date + time '10:00') at time zone 'Asia/Manila') as t1000,
       ((:'d'::date + time '12:00') at time zone 'Asia/Manila') as t1200,
       ((:'d'::date + time '14:00') at time zone 'Asia/Manila') as t1400 \gset

-- =====================================================================
\echo
\echo ===== 1. Guests (anon) =====
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false) \g /dev/null

select tests.ok(tests.visible('select * from public.services') = 6, 'guest can read the 6 active services');
select tests.throws('select * from public.customers',    'permission denied', 'guest cannot read customers');
select tests.throws('select * from public.reservations', 'permission denied', 'guest cannot read reservations');
select tests.throws('select * from public.payments',     'permission denied', 'guest cannot read payments');
select tests.throws($$insert into public.services (name, slug, duration_minutes, price) values ('x','x',30,1)$$,
  'permission denied', 'guest cannot create services');

select tests.ok(tests.visible($$select * from public.get_available_slots(
  '20000000-0000-4000-8000-000000000001', '$$ || :'d' || $$')$$) > 10,
  'availability engine returns slots for a working day');

select tests.ok(tests.visible($$select * from public.get_available_slots(
  '20000000-0000-4000-8000-000000000001', '$$ || :'d' || $$')
  where (slot_start at time zone 'Asia/Manila')::time >= '12:00'
    and (slot_start at time zone 'Asia/Manila')::time <  '13:00'$$) = 0,
  'no slots offered during the 12:00–13:00 lunch break');

select tests.ok(tests.visible($$select * from public.get_available_slots(
  '20000000-0000-4000-8000-000000000001', '2026-12-25')$$) = 0,
  'no slots on a clinic holiday');

select tests.ok(tests.visible($$select * from public.get_available_slots(
  '20000000-0000-4000-8000-000000000001', current_date - 1)$$) = 0,
  'no slots in the past');

-- Guest books a consultation with Dr Ana at 09:00 (30 min + 10 min buffer → blocks until 09:40)
select reference_code as ref1, status as st1 from public.book_appointment(
  '20000000-0000-4000-8000-000000000001', :'t0900', 'Juan Guest', 'juan@guest.local',
  '0917 123 4567', '30000000-0000-4000-8000-000000000001', 'First visit') \gset
select tests.ok(:'ref1' ~ '^[1-9][0-9]{7}$', 'guest booking returns an 8-digit booking number ' || :'ref1');
select tests.ok(:'st1' = 'confirmed', 'consultation (no deposit) is auto-confirmed');

select tests.throws(format($$select * from public.book_appointment(
  '20000000-0000-4000-8000-000000000001', %L, 'Maria Two', 'maria@guest.local', '09171112222',
  '30000000-0000-4000-8000-000000000001')$$, :'t0900'),
  'SLOT_UNAVAILABLE', 'same dentist + same time is rejected (double booking)');

select tests.throws(format($$select * from public.book_appointment(
  '20000000-0000-4000-8000-000000000001', %L, 'Maria Two', 'maria@guest.local', '09171112222',
  '30000000-0000-4000-8000-000000000001')$$, :'t0930'),
  'SLOT_UNAVAILABLE', '09:30 is rejected: it falls inside the 10-minute cleanup buffer');

select tests.ok(tests.visible(format($$select * from public.get_available_slots(
  '20000000-0000-4000-8000-000000000001', %L, '30000000-0000-4000-8000-000000000001')
  where slot_start = %L$$, :'d', :'t0915')) = 0,
  'the booked 09:00 slot no longer appears for 09:15 either');

select tests.throws($$select * from public.book_appointment(
  '20000000-0000-4000-8000-000000000001', now() + interval '3 days', 'x', 'bad-email', '123')$$,
  'INVALID_NAME', 'booking validates input');

select tests.ok(tests.visible(format($$select * from public.get_booking(%L, 'JUAN@guest.local')$$, :'ref1')) = 1,
  'guest can track a booking with reference + email (email case-insensitive)');
select tests.ok(tests.visible(format($$select * from public.get_booking(%L, 'attacker@evil.local')$$, :'ref1')) = 0,
  'tracking with the wrong email returns nothing');

-- Guest books a whitening (₱2,000 deposit) at 14:00 → pending with an expiry
select reference_code as ref2, status as st2, expires_at is not null as has_expiry
from public.book_appointment('20000000-0000-4000-8000-000000000005', :'t1400', 'Lia Deposit',
  'lia@guest.local', '09179998888', '30000000-0000-4000-8000-000000000001') \gset
select tests.ok(:'st2' = 'pending' and :'has_expiry', 'service with a deposit starts as pending with an expiry time');

select tests.throws(format($$select public.submit_payment(%L, 'lia@guest.local', 'cash', 2000, 'REF12345')$$, :'ref2'),
  'INVALID_METHOD', 'guests cannot self-report a cash payment');
select tests.throws(format($$select public.submit_payment(%L, 'lia@guest.local', 'gcash', 999999, 'REF12345')$$, :'ref2'),
  'INVALID_AMOUNT', 'cannot submit more than the balance');
select tests.throws(format($$select public.submit_payment(%L, 'lia@guest.local', 'gcash', 2000, 'REF12345', '11112222/x.png')$$, :'ref2'),
  'INVALID_PROOF_PATH', 'proof file must be in this booking''s own folder');

select public.submit_payment(:'ref2', 'lia@guest.local', 'gcash', 2000, '1009 876 5432', :'ref2' || '/proof.jpg') as pay2 \gset
select tests.ok((select payment_status from public.get_booking(:'ref2', 'lia@guest.local')) = 'awaiting_verification',
  'GCash screenshot is NOT treated as paid: status is awaiting_verification');

reset role;

-- =====================================================================
\echo
\echo ===== 2. Patients =====
-- Patient A books (logged in)
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000005","role":"authenticated"}', false) \g /dev/null

select reference_code as refa from public.book_appointment(
  '20000000-0000-4000-8000-000000000002', :'t1000', 'Patient A', 'ignored@x.local', '09170000001',
  '30000000-0000-4000-8000-000000000002') \gset
select tests.ok((select contact_email from public.reservations where reference_code = :'refa') = 'pat.a@test.local',
  'logged-in patient always books under their own verified email');

select tests.ok(tests.visible('select * from public.reservations') = 1,  'patient A sees only their own 1 reservation');
select tests.ok(tests.visible('select * from public.customers') = 1,     'patient A sees only their own customer record');
select tests.ok(tests.visible(format('select * from public.reservations where reference_code = %L', :'ref1')) = 0,
  'patient A cannot open the guest''s reservation by reference');
select tests.ok(tests.visible('select * from public.reservation_notes') = 0, 'patient cannot see internal staff notes');
select tests.ok(tests.visible('select * from public.audit_logs') = 0,        'patient cannot see the audit log');
select tests.ok(tests.visible('select * from public.resource_time_off') = 0, 'patient cannot see dentist leave reasons');

with u as (update public.reservations set status = 'cancelled' where reference_code = :'refa' returning 1)
select tests.ok((select count(*) from u) = 0, 'patient cannot update a reservation row directly (0 rows changed)');
select tests.throws($$insert into public.reservations (reference_code, customer_id, service_id, resource_id, starts_at,
  ends_at, blocked_until, contact_name, contact_email, contact_phone, price)
  values ('12345678', private.my_customer_id(), '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001', now() + interval '5 days', now(), now(), 'x', 'x@x.x', '0917000000', 0)$$,
  'row-level security', 'patient cannot insert a reservation directly (must use book_appointment)');

select tests.throws($$update public.profiles set role = 'owner' where id = auth.uid()$$,
  'FORBIDDEN', 'patient cannot promote themselves to owner');
select tests.throws($$update public.customers set is_vip = true where profile_id = auth.uid()$$,
  'FORBIDDEN', 'patient cannot mark themselves VIP');
update public.customers set phone = '09175550000' where profile_id = auth.uid();
select tests.ok((select phone from public.customers where profile_id = auth.uid()) = '09175550000',
  'patient CAN update their own phone number');

with u as (update public.payments set status = 'verified' returning 1)
select tests.ok((select count(*) from u) = 0, 'patient cannot verify payments');

select tests.ok(tests.visible('select * from public.notifications') = 0, 'patient sees no one else''s notifications');

-- Patient B sees none of A's data
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000006","role":"authenticated"}', false) \g /dev/null
select tests.ok(tests.visible('select * from public.reservations') = 0, 'patient B sees zero reservations (none are theirs)');
select tests.ok(tests.visible('select * from public.customers') = 1,    'patient B sees only their own customer record');
select tests.ok(tests.visible('select * from public.payments') = 0,     'patient B sees zero payments');
reset role;

-- =====================================================================
\echo
\echo ===== 3. Dentists =====
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', false) \g /dev/null  -- Dr Ana

select tests.ok(tests.visible('select * from public.reservations') = 2,
  'Dr Ana sees only her 2 appointments (not Dr Marco''s)');
select tests.ok(tests.visible(format('select * from public.reservations where reference_code = %L', :'refa')) = 0,
  'Dr Ana cannot see Patient A''s appointment with Dr Marco');
select tests.ok(tests.visible('select * from public.customers where profile_id is distinct from auth.uid()') = 2,
  'Dr Ana sees only her own 2 patients (plus her own record)');
select tests.ok(tests.visible('select * from public.payments') = 0,  'dentists cannot see payments');

select tests.throws(format($$update public.reservations set price = 1 where reference_code = %L$$, :'ref1'),
  'FORBIDDEN', 'dentist cannot change the price');
select tests.throws(format($$update public.reservations set status = 'cancelled' where reference_code = %L$$, :'ref1'),
  'FORBIDDEN', 'dentist cannot cancel (front desk job)');
update public.reservations set status = 'checked_in' where reference_code = :'ref1';
select tests.ok((select status from public.reservations where reference_code = :'ref1') = 'checked_in',
  'dentist CAN check in their own patient');
select tests.throws(format($$update public.reservations set status = 'confirmed' where reference_code = %L$$, :'ref1'),
  'INVALID_STATUS_TRANSITION', 'status cannot go backwards (checked_in → confirmed)');

with u as (update public.reservations set status = 'checked_in' where reference_code = :'refa' returning 1)
select tests.ok((select count(*) from u) = 0, 'Dr Ana cannot update Dr Marco''s appointment');
reset role;

-- =====================================================================
\echo
\echo ===== 4. Front desk (secretary) =====
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', false) \g /dev/null

select tests.ok(tests.visible('select * from public.reservations') = 3, 'secretary sees all 3 reservations');
select tests.ok(tests.visible('select * from public.audit_logs') = 0,   'secretary cannot read the audit log (owner only)');
select tests.ok(tests.visible($$select * from public.notifications where type = 'payment.submitted'$$) = 1,
  'secretary was notified about the GCash payment to verify');

select tests.throws(format($$insert into public.reservations (reference_code, customer_id, service_id, resource_id,
  starts_at, ends_at, blocked_until, status, source, contact_name, contact_email, contact_phone, price)
  select '22223333', id, '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  %L, %L, %L, 'confirmed', 'walk_in', 'Walk In', 'w@x.local', '09170001111', 500
  from public.customers limit 1$$, :'t0915', :'t0915', :'t0915'),
  'reservations_no_overlap', 'even staff cannot double-book a dentist (database constraint)');

with u as (update public.clinic_settings set name = 'Hacked' returning 1)
select tests.ok((select count(*) from u) = 0, 'secretary cannot change clinic settings (owner only)');

-- Verify Lia's GCash deposit → booking confirms automatically
update public.payments set status = 'verified' where id = :'pay2';
select tests.ok((select status from public.reservations where reference_code = :'ref2') = 'confirmed',
  'verifying the deposit auto-confirms the booking');
select tests.ok((select payment_status from public.reservations where reference_code = :'ref2') = 'partially_paid',
  'reservation shows partially paid (₱2,000 of ₱8,000)');
select tests.ok((select verified_by from public.payments where id = :'pay2') = 'a0000000-0000-4000-8000-000000000002',
  'payment records WHO verified it');
select tests.throws(format($$update public.payments set status = 'rejected' where id = %L$$, :'pay2'),
  'PAYMENT_FINALIZED', 'a verified payment cannot be flipped to rejected later');
select tests.throws(format($$update public.payments set amount = 1 where id = %L$$, :'pay2'),
  'FORBIDDEN', 'payment amount cannot be edited after submission');

-- Walk-in booked by the secretary: reference code comes from the column default
insert into public.reservations (customer_id, service_id, resource_id, starts_at, ends_at, blocked_until,
  status, source, contact_name, contact_email, contact_phone, price)
select id, '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002',
  (:'d'::date + time '15:00') at time zone 'Asia/Manila', now(), now(), 'confirmed', 'walk_in',
  'Walk In', 'walkin@x.local', '09170001111', 1000
from public.customers where lower(email) = 'juan@guest.local' and profile_id is null;
select tests.ok((select reference_code ~ '^[1-9][0-9]{7}$' from public.reservations where contact_email = 'walkin@x.local'),
  'staff walk-in booking gets an automatic 8-digit booking number');
select tests.ok((select ends_at - starts_at = interval '45 minutes' from public.reservations where contact_email = 'walkin@x.local'),
  'end time is calculated by the database, not trusted from the client');

insert into public.reservation_notes (reservation_id, author_id, body)
select id, auth.uid(), 'Patient is nervous; prefers morning.' from public.reservations where reference_code = :'ref1';
select tests.ok(tests.visible('select * from public.reservation_notes') = 1, 'secretary can add an internal note');
select tests.throws($$update public.profiles set role = 'owner' where id = auth.uid()$$,
  'FORBIDDEN', 'secretary cannot promote themselves');
reset role;

-- =====================================================================
\echo
\echo ===== 5. Owner =====
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false) \g /dev/null
select tests.ok(tests.visible('select * from public.audit_logs') > 0, 'owner can read the audit log');
select tests.ok(tests.visible(format($$select * from public.audit_logs where table_name = 'payments'
  and actor_id = 'a0000000-0000-4000-8000-000000000002'$$)) >= 1,
  'audit log shows the secretary verified the payment');
select tests.throws($$update public.profiles set role = 'patient' where id = auth.uid()$$,
  'LAST_OWNER', 'the last owner cannot demote themselves');
select tests.throws($$delete from public.audit_logs$$, 'permission denied', 'nobody can delete audit logs');
reset role;

-- =====================================================================
\echo
\echo ===== 6. Cancellation, expiry and email linking =====
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false) \g /dev/null
select public.cancel_booking(:'refa', 'pat.a@test.local', 'Schedule conflict') as c \gset
select tests.ok(:'c' = 'cancelled', 'patient can cancel more than 24 hours ahead');
select tests.ok(tests.visible(format($$select * from public.get_available_slots(
  '20000000-0000-4000-8000-000000000002', %L, '30000000-0000-4000-8000-000000000002')
  where slot_start = %L$$, :'d', :'t1000')) = 1, 'the cancelled slot is bookable again');
reset role;

-- A booking 2 hours from now cannot be cancelled online (24h cut-off)
insert into public.reservations (reference_code, customer_id, service_id, resource_id, starts_at, ends_at,
  blocked_until, status, contact_name, contact_email, contact_phone, price)
select '33334444', id, '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  date_trunc('minute', now()) + interval '2 hours', now(), now(), 'confirmed', 'Soon', 'soon@x.local', '09170002222', 500
from public.customers where lower(email) = 'juan@guest.local';
set role anon;
select tests.throws($$select public.cancel_booking('3333-4444', 'soon@x.local')$$,
  'CANCELLATION_WINDOW_PASSED', 'cannot cancel online inside the 24-hour window');
reset role;

-- An unpaid deposit booking whose hold has passed frees its slot
select reference_code as reflate from public.book_appointment(
   '20000000-0000-4000-8000-000000000003', (:'d'::date + time '16:00') at time zone 'Asia/Manila',
   'Late Payer', 'late@x.local', '09173334444') \gset
update public.reservations set expires_at = now() - interval '1 minute' where reference_code = :'reflate';
select tests.ok(private.expire_pending_reservations() = 1, 'expiry job expires the unpaid booking');
select tests.ok((select status from public.reservations where contact_email = 'late@x.local') = 'expired',
  'unpaid booking is now expired');

-- Someone signs up with juan@guest.local. Sign-up is instant (no email proof), so the
-- new account must NOT see Juan's guest bookings until it proves it has the booking number.
insert into auth.users (id, email, email_confirmed_at) values
  ('a0000000-0000-4000-8000-000000000009', 'juan@guest.local', now());
select tests.ok((select count(*) from public.customers where lower(email) = 'juan@guest.local' and profile_id is null) = 1,
  'a new account with a guest''s email does NOT take over the guest''s bookings');
select tests.ok((select count(*) from public.customers where profile_id = 'a0000000-0000-4000-8000-000000000009') = 1,
  'the new account gets its own patient record and can sign in right away');

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000009","role":"authenticated"}', false) \g /dev/null
select tests.ok((select count(*) from public.reservations where contact_email = 'juan@guest.local') = 0,
  'before claiming, the account sees none of the guest bookings');
select tests.throws('select public.claim_booking(''11111111'')', 'BOOKING_NOT_FOUND', 'a wrong booking number claims nothing');
select tests.throws(format('select public.claim_booking(%L)', :'ref2'), 'BOOKING_NOT_FOUND',
  'cannot claim a booking made with a different email');
select tests.ok(public.claim_booking(private.format_ref(:'ref1')) = :'ref1',
  'patient adds their old guest booking with the booking number (dash allowed)');
select tests.ok((select count(*) from public.reservations where reference_code = :'ref1') = 1,
  'after claiming, the booking shows in the account');
reset role;

-- Server-side admin code (service role) can create bookings too: the reference default must work for it
set role service_role;
insert into public.reservations (customer_id, service_id, resource_id, starts_at, ends_at, blocked_until,
  status, contact_name, contact_email, contact_phone, price)
select id, '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002',
  (:'d'::date + time '17:00') at time zone 'Asia/Manila', now(), now(), 'confirmed', 'Admin Insert', 'admin@x.local', '09170003333', 500
from public.customers where lower(email) = 'juan@guest.local' and profile_id is null;
select tests.ok((select reference_code ~ '^[1-9][0-9]{7}$' from public.reservations where contact_email = 'admin@x.local'),
  'service role inserts get a reference code (seed scripts, admin tools)');
reset role;

-- =====================================================================
\echo
\echo ===== 7. Booking numbers, quick closures, notification clean-up =====
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false) \g /dev/null
select tests.ok(tests.visible(format($$select * from public.get_booking(%L, 'juan@guest.local')$$,
  substr(:'ref1', 1, 4) || '-' || substr(:'ref1', 5))) = 1, 'booking number works typed with a dash (4827-3159)');
select tests.ok(tests.visible(format($$select * from public.get_booking(%L, 'juan@guest.local')$$,
  ' ' || substr(:'ref1', 1, 4) || ' ' || substr(:'ref1', 5) || ' ')) = 1, 'booking number works typed with spaces');
select tests.ok(private.format_ref('48273159') = '4827-3159', 'booking numbers display as 4827-3159');
reset role;

-- Dr Ana closes her own afternoon on the test date
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', false) \g /dev/null
insert into public.resource_time_off (resource_id, period, reason)
values ('30000000-0000-4000-8000-000000000001',
  tstzrange((:'d'::date + time '13:00') at time zone 'Asia/Manila', (:'d'::date + time '17:00') at time zone 'Asia/Manila', '[)'),
  'Urgent meeting');
select tests.ok((select created_by from public.resource_time_off where reason = 'Urgent meeting') = 'a0000000-0000-4000-8000-000000000003',
  'dentist can close their own afternoon (and it records who closed it)');
select tests.throws($$insert into public.resource_time_off (resource_id, period) values ('30000000-0000-4000-8000-000000000002',
  tstzrange(now() + interval '3 days', now() + interval '3 days 2 hours'))$$, 'row-level security',
  'dentist cannot close another dentist''s time');
reset role;

select tests.ok(tests.visible(format($$select * from public.get_available_slots(
  '20000000-0000-4000-8000-000000000001', %L, '30000000-0000-4000-8000-000000000001')
  where (slot_start at time zone 'Asia/Manila')::time >= '13:00'$$, :'d')) = 0,
  'closed afternoon offers no online times');

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', false) \g /dev/null
with x as (delete from public.resource_time_off where reason = 'Urgent meeting' returning 1)
select tests.ok((select count(*) from x) = 0, 'Dr Marco cannot reopen Dr Ana''s closed time');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', false) \g /dev/null
with x as (delete from public.resource_time_off where reason = 'Urgent meeting' returning 1)
select tests.ok((select count(*) from x) = 1, 'Dr Ana can reopen her own closed time');

-- Notifications: delete own only
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', false) \g /dev/null
with x as (delete from public.notifications where recipient_id = 'a0000000-0000-4000-8000-000000000001' returning 1)
select tests.ok((select count(*) from x) = 0, 'secretary cannot delete the owner''s notifications');
with x as (delete from public.notifications returning 1)
select tests.ok((select count(*) from x) > 0, 'secretary can delete all of their own notifications');
reset role;
select tests.ok((select count(*) from public.notifications where recipient_id = 'a0000000-0000-4000-8000-000000000001') > 0,
  'owner''s notifications are untouched');

-- =====================================================================
\echo
\echo ===== 8. Race condition: two bookings for the same slot at the same time =====
\echo (run separately by run.sh with two parallel connections)
\echo
\echo ALL TESTS PASSED
