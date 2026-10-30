# Security model

## Three layers

1. **Next.js** checks the role before rendering a page or running an action (`requireStaff()`, `requireFrontDesk()`, `requireOwner()` in `src/lib/auth.ts`). This gives friendly redirects and messages. **It is not the security boundary.**
2. **Row Level Security** decides which rows each user can read or change. The app queries Supabase *as the signed-in user*, so these rules apply to every page, every action, and any request someone builds by hand with the public key.
3. **Triggers** decide which *columns* can change and which status changes are legal. RLS works per row; it can't stop a patient from setting `is_vip = true` on their own row, so a trigger does.

If the Next.js check had a bug, layers 2 and 3 would still refuse the request. The database tests prove this by attacking the database directly as each role.

## Roles

| Role | Where it's stored | How it changes |
|---|---|---|
| anon (guest) | Not logged in | n/a |
| patient | `profiles.role` | Every new signup is a patient, always |
| dentist, receptionist, owner | `profiles.role` | Only an owner can change roles |

The role is **never** read from the JWT's user metadata, because users can edit their own metadata. `handle_new_user()` ignores any `"role"` sent at signup (a test sends `"role":"owner"` and checks the account still becomes a patient).

## Helper functions

Policies call small functions in the `private` schema, which is not exposed through the API:

```sql
private.user_role()        -- role of the logged-in user (from profiles, active users only)
private.is_front_desk()    -- owner or receptionist
private.is_staff()         -- front desk or dentist
private.my_customer_id()   -- the patient record linked to this login
private.my_resource_ids()  -- the dentist calendar(s) linked to this login
private.my_patient_ids()   -- patients this dentist has appointments with
```

They're `SECURITY DEFINER` (they read `profiles` without being blocked by RLS) with `set search_path = ''`, so nobody can hijack them by creating look-alike tables in another schema. Policies wrap them as `(select private.is_front_desk())` so Postgres evaluates them once per query, not once per row.

## The key policies, explained

### Reservations

```sql
create policy "reservations: patient own, dentist assigned, front desk all"
  on public.reservations for select to authenticated
  using (
    (select private.is_front_desk())                      -- receptionist/owner: everything
    or customer_id = (select private.my_customer_id())    -- patient: bookings on their own record
    or resource_id in (select private.my_resource_ids())  -- dentist: bookings on their own calendar
  );
```

- **Insert:** front desk only. Patients and guests book through `book_appointment()`, which validates the time slot, price and status server-side. A patient can't insert a reservation with a made-up price or a time outside opening hours.
- **Update:** front desk, or the assigned dentist. The trigger then limits dentists to `checked_in`, `in_progress`, `completed` and `no_show`, and to changing nothing except the status.
- **Delete:** no policy at all, so nobody can delete. Bookings are cancelled, which keeps reports and history honest.

### Notes and history inherit visibility

```sql
using (exists (select 1 from public.reservations r where r.id = reservation_id))
```

The sub-query runs under the reservations policy, so "who can see a note" is defined in one place. Notes add `private.is_staff()`, so patients never see them, even on their own booking.

### Payments

- **Select:** front desk sees all; a patient sees payments on their own bookings. Dentists see none.
- **Insert:** front desk only (cash at the desk, refunds). Patients and guests use `submit_payment()`, which always creates the payment as `awaiting_verification`, only for GCash, Maya or bank transfer, and never above the remaining balance.
- **Update:** front desk only. The trigger then:
  - stamps `verified_by` and `verified_at` itself, ignoring anything the client sends
  - refuses to change a payment after it's verified or rejected (record a refund instead)
  - refuses to change the amount, method or receipt after submission

### Payment receipts (Storage)

The `payment-proofs` bucket is **private**. Staff open receipts through signed URLs that expire after 5 minutes, created on the server only after an RLS check confirms they can see that payment. Files are stored as `<REFERENCE>/<random-uuid>.<ext>`: the uploaded file name is never used, and `submit_payment()` refuses a path outside the booking's own folder. There are no update or delete policies, so a submitted receipt can't be swapped later.

### Audit log

Written by triggers running as the database owner. The API gets `select` only (owner), with no insert, update or delete grant, so nobody can tamper with it through the app.

## Guest booking without accounts

A guest proves ownership of a booking with **reference number + email**:

- References are 8 characters from a 31-character alphabet with no 0/O/1/I/L (about 850 billion combinations), generated with `gen_random_bytes`.
- Lookups need both values to match. The error message is the same whether the reference or the email was wrong, so it doesn't reveal which bookings exist.
- Only the reference ever appears in a URL. The email stays out of links, logs and browser history.

When a guest later creates an account with the same email, their old bookings are linked **only after the email is confirmed**. Otherwise anyone could sign up with someone else's email and see their appointments. A test covers exactly this case.

## Other measures

- `GRANT`s start from zero (`revoke all … from anon, authenticated`), then grant only what each role needs. Postgres functions are revoked from `PUBLIC` and granted explicitly.
- Every Server Action validates input with Zod; the database functions validate again.
- Search text is stripped to letters, numbers, spaces and `@.-` before it goes into a PostgREST filter, since commas and parentheses would change the filter's meaning.
- `safeNext()` blocks open redirects in `?next=` (`//evil.com`, `/\evil.com`, absolute URLs, control characters).
- A honeypot field on the booking form catches simple bots.
- The secret key lives only in server environment variables and files marked `server-only`.

## Known limitations (honest list)

- **No rate limiting or CAPTCHA** on public forms yet. A determined bot could create many bookings. Production should add Cloudflare Turnstile and per-IP limits.
- **Saving a service's dentist list, or a dentist's weekly hours, takes two statements** (delete, then insert). If the second failed, the list would be empty until saved again. Moving these into one database function would make them atomic.
- **Emails are best-effort.** If Resend is down, the booking still succeeds and the in-app notification is still written, but the email is lost (no retry queue).
- **Staff invitations** are manual: the person signs up as a patient, then the owner changes their role.
