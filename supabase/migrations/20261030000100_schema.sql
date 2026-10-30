-- =====================================================================
-- SmileSlot — Dental clinic booking system
-- Migration 1: extensions, enums and tables
--
-- Design rules used throughout:
--   * Every money column is numeric(10,2). Never float for money.
--   * Every timestamp is timestamptz (stored in UTC, shown in Asia/Manila).
--   * Data minimisation: we store booking + contact data only.
--     NO treatment records, diagnoses or medical history.
-- =====================================================================

create extension if not exists btree_gist with schema extensions;   -- lets uuid "=" live inside a GiST exclusion constraint
create extension if not exists pgcrypto  with schema extensions;   -- gen_random_bytes for reference codes

-- Schema for helper functions. Not exposed through the Supabase API.
create schema if not exists private;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.app_role as enum ('owner', 'secretary', 'dentist', 'patient');

create type public.resource_type as enum ('dentist', 'chair', 'room', 'equipment');

create type public.reservation_status as enum (
  'pending',      -- waiting for approval or deposit
  'confirmed',    -- accepted
  'checked_in',   -- patient arrived
  'in_progress',  -- treatment ongoing
  'completed',    -- finished
  'cancelled',    -- cancelled by patient or clinic
  'rejected',     -- declined by clinic
  'no_show',      -- patient did not arrive
  'expired'       -- pending too long without deposit
);

create type public.booking_source as enum ('online', 'walk_in', 'phone', 'manual');

create type public.payment_method as enum ('cash', 'gcash', 'maya', 'bank_transfer', 'card', 'online_gateway');
create type public.payment_kind   as enum ('payment', 'refund');

-- Status of ONE payment transaction
create type public.payment_txn_status as enum ('awaiting_verification', 'verified', 'rejected', 'failed');

-- Overall payment status of a RESERVATION (derived from its transactions)
create type public.payment_status as enum (
  'unpaid', 'awaiting_verification', 'partially_paid', 'paid', 'refunded', 'failed'
);

-- ---------------------------------------------------------------------
-- Clinic settings (single row)
-- ---------------------------------------------------------------------
create table public.clinic_settings (
  id                        smallint primary key default 1 check (id = 1),
  name                      text not null,
  tagline                   text,
  logo_path                 text,
  email                     text,
  phone                     text,
  address                   text,
  map_url                   text,
  timezone                  text not null default 'Asia/Manila',
  currency                  char(3) not null default 'PHP',
  slot_interval_minutes     int not null default 15  check (slot_interval_minutes between 5 and 120),
  min_notice_minutes        int not null default 120 check (min_notice_minutes >= 0),
  max_advance_days          int not null default 60  check (max_advance_days between 1 and 365),
  cancellation_cutoff_hours int not null default 24  check (cancellation_cutoff_hours >= 0),
  pending_expiry_minutes    int not null default 60  check (pending_expiry_minutes between 5 and 10080),
  auto_confirm              boolean not null default true,
  booking_policy            text,
  cancellation_policy       text,
  payment_instructions      text check (char_length(payment_instructions) <= 1000),  -- shown to patients: GCash/Maya/bank details
  updated_at                timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Users
-- profiles: one row per login (auth.users). Role lives here, never in
-- user-editable JWT metadata.
-- ---------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '' check (char_length(full_name) <= 120),
  phone      text check (char_length(phone) <= 30),
  role       public.app_role not null default 'patient',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------
create table public.service_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (char_length(name) between 1 and 80),
  sort_order int not null default 0
);

create table public.services (
  id                uuid primary key default gen_random_uuid(),
  category_id       uuid references public.service_categories(id) on delete set null,
  name              text not null check (char_length(name) between 1 and 120),
  slug              text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description       text check (char_length(description) <= 2000),
  duration_minutes  int not null check (duration_minutes between 5 and 480),
  buffer_minutes    int not null default 0 check (buffer_minutes between 0 and 120),  -- cleanup time after the appointment
  price             numeric(10,2) not null check (price >= 0),
  deposit_amount    numeric(10,2) not null default 0 check (deposit_amount >= 0),
  requires_approval boolean not null default false,
  is_active         boolean not null default true,
  photo_path        text,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint services_deposit_le_price check (deposit_amount <= price)
);

-- A resource is anything that gets occupied by an appointment.
-- For the clinic: each dentist is a resource (optionally linked to a login).
create table public.resources (
  id         uuid primary key default gen_random_uuid(),
  type       public.resource_type not null default 'dentist',
  name       text not null check (char_length(name) between 1 and 120),
  title      text check (char_length(title) <= 120),        -- e.g. "General Dentist"
  bio        text check (char_length(bio) <= 1000),
  profile_id uuid unique references public.profiles(id) on delete set null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- Which dentists can perform which services
create table public.service_resources (
  service_id  uuid not null references public.services(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete cascade,
  primary key (service_id, resource_id)
);

-- Weekly schedule. Several rows per day = breaks (e.g. 09–12 and 13–17).
create table public.working_hours (
  id          uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6),  -- 0 = Sunday (same as extract(dow))
  start_time  time not null,
  end_time    time not null,
  constraint working_hours_valid check (end_time > start_time)
);

-- Whole-clinic closures (holidays)
create table public.clinic_closures (
  id        uuid primary key default gen_random_uuid(),
  closed_on date not null unique,
  reason    text check (char_length(reason) <= 200)
);

-- Leave / unavailable periods for one dentist (reason is staff-only)
create table public.resource_time_off (
  id          uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  period      tstzrange not null check (not isempty(period)),
  reason      text check (char_length(reason) <= 200)
);

-- ---------------------------------------------------------------------
-- Customers (patients). A guest booking creates a customer with no login.
-- ---------------------------------------------------------------------
create table public.customers (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  full_name  text not null check (char_length(full_name) between 1 and 120),
  email      text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  phone      text check (char_length(phone) <= 30),
  is_vip     boolean not null default false,
  tags       text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index customers_email_key on public.customers (lower(email));

-- ---------------------------------------------------------------------
-- Reservations
-- ---------------------------------------------------------------------
create table public.reservations (
  id               uuid primary key default gen_random_uuid(),
  reference_code   text not null unique,
  customer_id      uuid not null references public.customers(id) on delete restrict,
  service_id       uuid not null references public.services(id)  on delete restrict,
  resource_id      uuid not null references public.resources(id) on delete restrict,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  blocked_until    timestamptz not null,       -- ends_at + service buffer; what the calendar actually blocks
  status           public.reservation_status not null default 'pending',
  source           public.booking_source not null default 'online',
  -- Contact details exactly as typed for THIS booking
  contact_name     text not null check (char_length(contact_name) between 1 and 120),
  contact_email    text not null check (char_length(contact_email) <= 254),
  contact_phone    text not null check (char_length(contact_phone) between 7 and 30),
  patient_notes    text check (char_length(patient_notes) <= 1000),
  -- Money snapshot taken at booking time (price changes later don't rewrite history)
  price            numeric(10,2) not null check (price >= 0),
  deposit_required numeric(10,2) not null default 0 check (deposit_required >= 0),
  amount_paid      numeric(10,2) not null default 0,
  payment_status   public.payment_status not null default 'unpaid',
  expires_at       timestamptz,
  status_reason    text check (char_length(status_reason) <= 500),
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint reservations_time_valid   check (ends_at > starts_at),
  constraint reservations_buffer_valid check (blocked_until >= ends_at),

  -- THE double-booking guard. Postgres itself refuses two active
  -- reservations for the same dentist whose time ranges overlap — even if
  -- two requests arrive at the same millisecond.
  constraint reservations_no_overlap exclude using gist (
    resource_id with =,
    tstzrange(starts_at, blocked_until, '[)') with &&
  ) where (status in ('pending', 'confirmed', 'checked_in', 'in_progress', 'completed'))
);
create index reservations_customer_idx on public.reservations (customer_id);
create index reservations_service_idx  on public.reservations (service_id);
create index reservations_starts_idx   on public.reservations (starts_at);
create index reservations_status_idx   on public.reservations (status);

-- Internal staff notes live in their own table so patients can never read them.
create table public.reservation_notes (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  author_id      uuid references public.profiles(id) on delete set null,
  body           text not null check (char_length(body) between 1 and 2000),
  created_at     timestamptz not null default now()
);
create index reservation_notes_reservation_idx on public.reservation_notes (reservation_id);

create table public.reservation_status_history (
  id             bigint generated always as identity primary key,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  from_status    public.reservation_status,
  to_status      public.reservation_status not null,
  changed_by     uuid references public.profiles(id) on delete set null,
  reason         text,
  changed_at     timestamptz not null default now()
);
create index reservation_status_history_reservation_idx on public.reservation_status_history (reservation_id);

-- ---------------------------------------------------------------------
-- Payments: one row per transaction. Refunds are their own rows.
-- ---------------------------------------------------------------------
create table public.payments (
  id               uuid primary key default gen_random_uuid(),
  reservation_id   uuid not null references public.reservations(id) on delete restrict,
  kind             public.payment_kind not null default 'payment',
  method           public.payment_method not null,
  amount           numeric(10,2) not null check (amount > 0),
  status           public.payment_txn_status not null default 'awaiting_verification',
  reference_no     text check (char_length(reference_no) <= 100),  -- GCash/Maya/bank reference number
  proof_path       text check (char_length(proof_path) <= 300),    -- private storage path of the screenshot
  submitted_by     uuid references public.profiles(id) on delete set null,
  verified_by      uuid references public.profiles(id) on delete set null,
  verified_at      timestamptz,
  rejection_reason text check (char_length(rejection_reason) <= 500),
  created_at       timestamptz not null default now()
);
create index payments_reservation_idx on public.payments (reservation_id);
create index payments_status_idx      on public.payments (status);

-- ---------------------------------------------------------------------
-- In-app notifications & audit log
-- ---------------------------------------------------------------------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  type         text not null,
  title        text not null,
  body         text,
  link         text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_id, read_at);

create table public.audit_logs (
  id         bigint generated always as identity primary key,
  actor_id   uuid,
  action     text not null,          -- INSERT / UPDATE / DELETE
  table_name text not null,
  record_id  text,
  old_data   jsonb,
  new_data   jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_record_idx  on public.audit_logs (table_name, record_id);
