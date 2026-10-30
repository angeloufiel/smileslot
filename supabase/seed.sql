-- =====================================================================
-- Demo catalog for a FICTIONAL clinic. Safe to run on a fresh database.
-- Demo login accounts are created separately by scripts/seed-demo-users.ts
-- (through the Supabase Admin API, so passwords are hashed by Supabase).
-- =====================================================================

insert into public.clinic_settings (id, name, tagline, email, phone, address,
  booking_policy, cancellation_policy, payment_instructions)
values (1, 'Harborview Dental Clinic', 'Gentle, on-time dental care',
  'hello@harborview-dental.example', '+63 917 000 0000',
  'Rizal Avenue, Pagadian City, Zamboanga del Sur',
  'Please arrive 10 minutes early. Treatments with a deposit are held for 60 minutes while you pay.',
  'Cancel online up to 24 hours before your appointment. Within 24 hours, please call the clinic.',
  E'GCash or Maya: 0917 000 0000 (Harborview Dental Clinic)\nBank transfer: Demo Bank, account name Harborview Dental Clinic, account no. 0000-0000-00\nKeep a screenshot of your receipt. You will upload it with your reference number.')
on conflict (id) do nothing;

insert into public.service_categories (id, name, sort_order) values
  ('10000000-0000-4000-8000-000000000001', 'General Dentistry', 1),
  ('10000000-0000-4000-8000-000000000002', 'Restorative',       2),
  ('10000000-0000-4000-8000-000000000003', 'Cosmetic',          3),
  ('10000000-0000-4000-8000-000000000004', 'Orthodontics',      4)
on conflict do nothing;

insert into public.services (id, category_id, name, slug, description,
  duration_minutes, buffer_minutes, price, deposit_amount, requires_approval, sort_order) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'Consultation & Check-up', 'consultation',
   'Full oral examination and treatment plan.', 30, 10, 500.00, 0, false, 1),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
   'Oral Prophylaxis (Cleaning)', 'cleaning',
   'Scaling and polishing to remove plaque and tartar.', 45, 15, 1000.00, 0, false, 2),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002',
   'Tooth Extraction (Simple)', 'extraction',
   'Removal of a visible tooth under local anesthesia.', 45, 15, 1500.00, 300.00, false, 3),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002',
   'Composite Filling', 'filling',
   'Tooth-colored filling per surface.', 60, 15, 1500.00, 0, false, 4),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000003',
   'Teeth Whitening', 'whitening',
   'In-clinic whitening session.', 90, 15, 8000.00, 2000.00, false, 5),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000004',
   'Braces Consultation', 'braces-consultation',
   'Assessment for orthodontic treatment. The clinic confirms after review.', 30, 10, 800.00, 0, true, 6)
on conflict do nothing;

insert into public.resources (id, type, name, title) values
  ('30000000-0000-4000-8000-000000000001', 'dentist', 'Dr. Ana Villanueva', 'General Dentist'),
  ('30000000-0000-4000-8000-000000000002', 'dentist', 'Dr. Marco Dela Peña', 'Orthodontist')
on conflict do nothing;

-- Dr. Villanueva: all general, restorative and cosmetic services
-- Dr. Dela Peña: consultations, cleaning and braces
insert into public.service_resources (service_id, resource_id) values
  ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000002')
on conflict do nothing;

-- Dr. Villanueva: Mon–Sat, 09:00–12:00 and 13:00–17:00 (lunch break 12–1)
insert into public.working_hours (resource_id, weekday, start_time, end_time)
select '30000000-0000-4000-8000-000000000001', d, t.s, t.e
from generate_series(1, 6) d,
     (values (time '09:00', time '12:00'), (time '13:00', time '17:00')) as t(s, e)
where not exists (select 1 from public.working_hours
                  where resource_id = '30000000-0000-4000-8000-000000000001');

-- Dr. Dela Peña: Tue–Sat, 10:00–12:00 and 13:00–18:00
insert into public.working_hours (resource_id, weekday, start_time, end_time)
select '30000000-0000-4000-8000-000000000002', d, t.s, t.e
from generate_series(2, 6) d,
     (values (time '10:00', time '12:00'), (time '13:00', time '18:00')) as t(s, e)
where not exists (select 1 from public.working_hours
                  where resource_id = '30000000-0000-4000-8000-000000000002');

insert into public.clinic_closures (closed_on, reason) values
  ('2026-11-01', 'All Saints'' Day'),
  ('2026-11-30', 'Bonifacio Day'),
  ('2026-12-08', 'Feast of the Immaculate Conception'),
  ('2026-12-24', 'Christmas Eve'),
  ('2026-12-25', 'Christmas Day'),
  ('2026-12-30', 'Rizal Day'),
  ('2026-12-31', 'New Year''s Eve')
on conflict (closed_on) do nothing;
