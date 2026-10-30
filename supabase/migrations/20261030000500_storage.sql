-- =====================================================================
-- Migration 5: private storage for payment screenshots
--
-- Bucket is PRIVATE: files are reachable only through short-lived
-- signed URLs created by the server for authorised users.
-- Path convention: payment-proofs/<RESERVATION REFERENCE>/<random file name>
--
-- Guests upload through a Next.js server action that first checks the
-- reference + email, then uploads with the service role. Logged-in
-- patients may upload into their own bookings' folders directly.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Is <reference> a booking that belongs to the logged-in patient?
create or replace function private.owns_booking_reference(p_reference text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.reservations r
    where r.reference_code = p_reference
      and r.customer_id = private.my_customer_id()
  )
$$;
revoke all on function private.owns_booking_reference(text) from public;
grant execute on function private.owns_booking_reference(text) to authenticated;

create policy "payment proofs: front desk reads all"
  on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and (select private.is_front_desk()));

create policy "payment proofs: patient reads own"
  on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs'
         and private.owns_booking_reference((storage.foldername(name))[1]));

create policy "payment proofs: patient uploads to own booking folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs'
              and private.owns_booking_reference((storage.foldername(name))[1]));

-- No update/delete policies: a submitted proof cannot be swapped afterwards.
