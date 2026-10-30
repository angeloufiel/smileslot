# Deploying SmileSlot

About 30–45 minutes the first time. You need free accounts on **GitHub**, **Supabase** and **Vercel**, plus Node.js 20 or newer on your computer.

## 1. Put the code on GitHub

1. Create an empty **public** repository on GitHub, e.g. `smileslot`. Don't add a README; the project has one.
2. In GitHub Desktop: **File → Add local repository** → choose the `smileslot` folder → **Publish repository**.
3. Before publishing, check that `.env.local` is **not** in the list of files. It's in `.gitignore`, so it shouldn't be.

## 2. Create the Supabase project

1. supabase.com → **New project**. Pick the **Southeast Asia (Singapore)** region (closest to the Philippines). Save the database password in a password manager.
2. **Project Settings → API Keys**: copy the **Project URL**, the **publishable** key and the **secret** key.

## 3. Create the database

In a terminal inside the project folder:

```bash
npm install
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF      # the part before .supabase.co
npx supabase db push --include-seed                   # runs all migrations + starter clinic data (rename it in Settings)
```

Check in the Supabase dashboard:
- **Table Editor** shows `services` with 6 rows.
- **Advisors → Security Advisor** shows no "RLS disabled" errors.
- **Integrations → Cron** shows the job `expire-pending-reservations`. If it's missing, enable the **pg_cron** extension (Database → Extensions) and run `npx supabase db push` again.

## 4. Configure sign-in emails

**Authentication → URL Configuration**
- Site URL: `http://localhost:3000` for now (you'll change it after step 6)
- Redirect URLs: add `http://localhost:3000/**`

**Authentication → Email Templates**
- *Confirm signup*, link URL:
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/my/bookings`
- *Reset password*, link URL:
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`

Supabase's built-in email sender has a low hourly limit and is meant for testing. For real use, connect your own SMTP (Resend offers SMTP) under **Authentication → SMTP Settings**.

## 5. Run it on your computer

```bash
cp .env.example .env.local
```

Fill in `.env.local` with the URL and keys from step 2, and choose a new `DEMO_PASSWORD` (at least 10 characters). Don't reuse `local-test-only-pw` from the test scripts; it's public in this repository. Then:

```bash
npm run seed:users   # creates the 5 demo logins
npm run dev          # open http://localhost:3000
```

Sign in as `secretary@demo.smileslot.app` with your demo password.

## 6. Deploy to Vercel

1. vercel.com → **Add New → Project** → import the GitHub repository. Vercel detects Next.js.
2. **Environment Variables**: add the same values as `.env.local`, except:
   - `NEXT_PUBLIC_SITE_URL` = your Vercel URL, e.g. `https://smileslot.vercel.app`
   - leave out `DEMO_PASSWORD` (only the seed script uses it)
3. **Deploy**.
4. Back in Supabase → **Authentication → URL Configuration**: set **Site URL** to your Vercel URL and add `https://YOUR-APP.vercel.app/**` to Redirect URLs.

## 7. Optional: real emails with Resend

1. resend.com → create an API key and verify a sending domain (or use their test address while trying it out).
2. Add `RESEND_API_KEY` and `EMAIL_FROM` to Vercel's environment variables and redeploy.

Without these, the app works normally and logs `[email skipped]` instead of sending.

## Before you share the link

- [ ] `git log -p | grep -i "sb_secret"` returns nothing (no secret key was ever committed)
- [ ] The demo password is not written anywhere in the repository
- [ ] Signed out, `/dashboard` redirects to the sign-in page
- [ ] As `dr.marco@demo.smileslot.app`, an appointment of Dr. Ana's opened by URL shows "not found"
- [ ] A GCash receipt submitted from **Find my booking** appears in **Payments** and stays unpaid until verified
- [ ] Check your plan's backup policy under **Database → Backups**. For a demo you can also take a manual copy with `npx supabase db dump -f backup.sql`.

## Updating the database later

Add a new file in `supabase/migrations/` (never edit one that's already been pushed), then:

```bash
npx supabase db push
npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts
npm run test:db    # needs a local PostgreSQL; CI also runs it on every push
```
