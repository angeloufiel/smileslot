# Database design

All schema lives in `supabase/migrations/`, applied in order:

| File | Contents |
|---|---|
| `…100_schema.sql` | Enums and tables |
| `…200_triggers_and_helpers.sql` | Role helper functions, column guards, status rules, payment rules, audit log, notifications |
| `…300_booking_engine.sql` | Availability, booking, tracking, cancellation and payment functions; expiry job |
| `…400_rls.sql` | Grants and Row Level Security policies |
| `…500_storage.sql` | Private bucket for payment receipts and its policies |

## Entity relationship diagram

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : "has"
  PROFILES ||--o| CUSTOMERS : "patient record"
  PROFILES ||--o| RESOURCES : "dentist login"
  SERVICE_CATEGORIES ||--o{ SERVICES : groups
  SERVICES ||--o{ SERVICE_RESOURCES : "offered by"
  RESOURCES ||--o{ SERVICE_RESOURCES : offers
  RESOURCES ||--o{ WORKING_HOURS : "weekly schedule"
  RESOURCES ||--o{ RESOURCE_TIME_OFF : "leave"
  CUSTOMERS ||--o{ RESERVATIONS : books
  SERVICES ||--o{ RESERVATIONS : "what"
  RESOURCES ||--o{ RESERVATIONS : "with whom"
  RESERVATIONS ||--o{ PAYMENTS : "paid by"
  RESERVATIONS ||--o{ RESERVATION_NOTES : "staff notes"
  RESERVATIONS ||--o{ RESERVATION_STATUS_HISTORY : "history"
  PROFILES ||--o{ NOTIFICATIONS : receives

  PROFILES {
    uuid id PK "= auth.users.id"
    text full_name
    app_role role "owner | secretary | dentist | patient"
    bool is_active
  }
  CUSTOMERS {
    uuid id PK
    uuid profile_id FK "null for guests"
    text full_name
    text email UK "case-insensitive"
    text phone
    bool is_vip
  }
  SERVICES {
    uuid id PK
    text name
    int duration_minutes
    int buffer_minutes "cleanup after"
    numeric price
    numeric deposit_amount
    bool requires_approval
    bool is_active
  }
  RESOURCES {
    uuid id PK
    resource_type type "dentist | chair | room | equipment"
    text name
    uuid profile_id FK "dentist's login"
  }
  WORKING_HOURS {
    uuid resource_id FK
    smallint weekday "0 = Sunday"
    time start_time
    time end_time
  }
  RESERVATIONS {
    uuid id PK
    text reference_code UK "8 digits, shown 4827-3159"
    uuid customer_id FK
    uuid service_id FK
    uuid resource_id FK
    timestamptz starts_at
    timestamptz ends_at
    timestamptz blocked_until "ends_at + buffer"
    reservation_status status
    numeric price "snapshot"
    numeric deposit_required "snapshot"
    numeric amount_paid "derived"
    payment_status payment_status "derived"
    timestamptz expires_at "unpaid hold"
  }
  PAYMENTS {
    uuid id PK
    uuid reservation_id FK
    payment_kind kind "payment | refund"
    payment_method method
    numeric amount
    payment_txn_status status
    text proof_path "private storage"
    uuid verified_by FK "stamped by DB"
  }
  AUDIT_LOGS {
    bigint id PK
    uuid actor_id
    text action
    text table_name
    jsonb old_data
    jsonb new_data
  }
```

(`CLINIC_SETTINGS` is a single-row table and `CLINIC_CLOSURES` is a list of dates; neither has relationships.)

## Design decisions

**Normalised to 3NF, with deliberate snapshots.** A reservation copies the price, deposit and contact details at booking time. If the clinic raises a price next month, last month's bookings and revenue stay correct. That's intentional denormalisation of history, not duplication of live data.

**`resources` instead of a `dentists` table.** A dentist is one kind of resource (others: chair, room, equipment). The availability engine and the double-booking constraint work on any resource, so adding chairs or rooms later doesn't need a redesign.

**Breaks are gaps, not rows.** Monday 09:00–12:00 and 13:00–17:00 are two `working_hours` rows; the lunch break is simply the time between them.

**Money is `numeric(10,2)`, time is `timestamptz`.** No floating-point money. Times are stored in UTC and shown in the clinic's time zone (Asia/Manila, configurable).

**Payments are a ledger.** Each payment or refund is its own row and is never edited after review. A reservation's `amount_paid` and `payment_status` are recalculated from that ledger by a trigger, so they can't drift.

**Data minimisation.** Booking and contact details only. No diagnoses, treatment records or medical history are stored, which keeps the privacy risk (Philippine Data Privacy Act; HIPAA for US clinics) much smaller.

## How availability is calculated

`get_available_slots(service, date, dentist?)` offers a start time only if **all** of these hold:

1. The dentist offers the service and is active
2. The whole appointment fits inside one of the dentist's working-hour blocks that weekday
3. The clinic isn't closed that day, and the dentist has no time off overlapping it
4. No active booking overlaps `[start, start + duration + cleanup buffer)`
5. It's at least the minimum notice from now and within the maximum advance window

Pending bookings whose deposit hold has expired don't block a slot, even before the expiry job has run.

`book_appointment()` re-checks that the requested time is one the engine would offer, then inserts. If another request won the slot a moment earlier, the exclusion constraint rejects the insert and the patient sees "That time was just taken."

## Guest and account records

`customers.email` is unique only among guest records (`profile_id is null`). An account always has its own record, so typing someone's email as a guest never adds a booking to their account, and signing up never adopts someone's guest bookings. A patient adds an old guest booking with `claim_booking(booking number)`.

## Booking status flow

```mermaid
stateDiagram-v2
  [*] --> pending: needs deposit or approval
  [*] --> confirmed: auto-confirm
  pending --> confirmed: approved / deposit verified
  pending --> rejected
  pending --> cancelled
  pending --> expired: unpaid hold ran out
  confirmed --> checked_in
  confirmed --> cancelled
  confirmed --> no_show
  checked_in --> in_progress
  checked_in --> completed
  in_progress --> completed
```

Any other change is refused by the `reservation_before_write` trigger. A unit test checks that the dashboard's buttons match these rules exactly.

## Regenerating TypeScript types

After changing the schema:

```bash
npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts
```
