"""
End-to-end walk through SmileSlot as every role (guest, receptionist, two dentists, owner, patient),
against a running app wired to real Supabase Auth + PostgREST (see tests/local-stack/README.md).

    pip install playwright && playwright install chromium
    python tests/e2e/smoke.py

Needs the demo accounts from `npm run seed:users` with DEMO_PASSWORD=local-test-only-pw.
"""
import os, re, struct, zlib, sys
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
PW = os.environ.get("DEMO_PASSWORD", "local-test-only-pw")
SHOTS = os.environ.get("SHOTS", "tests/e2e/screenshots")
os.makedirs(SHOTS, exist_ok=True)
RECEIPT = os.path.join(SHOTS, "receipt.png")
results = []

def ok(name, cond=True):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name, flush=True)

def png_bytes():
    raw = b"\x00" + b"\x2b\x44\xc9" * 4
    data = b"".join(raw for _ in range(4))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 4, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(data)) + chunk(b"IEND", b"")

open(RECEIPT, "wb").write(png_bytes())

def login(page, email):
    page.goto(f"{BASE}/login")
    page.fill("input[name=email]", email)
    page.fill("input[name=password]", PW)
    page.click("button[type=submit]")
    page.wait_for_load_state("networkidle")

def left(page, path):
    """True once the browser has been redirected away from path (redirects can arrive in the streamed part)."""
    try:
        page.wait_for_url(lambda u: path not in u, timeout=10000)
        return True
    except Exception:
        return False

def shows(page, selector):
    try:
        page.wait_for_selector(selector, timeout=10000)
        return True
    except Exception:
        return False

def logout(ctx):
    ctx.clear_cookies()

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1366, "height": 900})
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("dialog", lambda d: d.accept("Receipt amount does not match") if d.type == "prompt" else d.accept())

    # ---------- 1. Guest books from the hero ----------
    page.goto(BASE)
    chips = page.locator("a[href*='&start=']")   # hero time buttons only (service links have no start time)
    ok("home shows live open-time chips", shows(page, "a[href*='&start=']") and chips.count() >= 3)
    page.screenshot(path=f"{SHOTS}/01-home.png", full_page=True)
    chips.nth(1).click()   # second chip: the first can drop inside the minimum-notice window while the test runs
    page.wait_for_url(re.compile(r"/book\?"))
    page.wait_for_selector("text=Your details", timeout=15000)
    ok("hero chip pre-selects service, dentist and time", page.locator("button[role=radio][aria-checked=true]").count() >= 3)
    page.fill("input[name=fullName]", "Juan Dela Cruz")
    page.fill("input[name=email]", "juan.guest@example.com")
    page.fill("input[name=phone]", "0917 555 1234")
    page.fill("textarea[name=notes]", "Sensitive lower left molar")
    page.screenshot(path=f"{SHOTS}/02-book-form.png", full_page=True)
    page.click("button:has-text('Book this time')")
    page.wait_for_selector("text=Reference number", timeout=15000)
    ref1 = page.locator("p.font-display.text-2xl").inner_text().strip()
    ok(f"guest booking confirmed with reference {ref1}", re.fullmatch(r"SS-[A-Z0-9]{8}", ref1))
    ok("consultation is auto-confirmed", page.locator("text=You're booked.").count() == 1)
    page.screenshot(path=f"{SHOTS}/03-confirmation.png", full_page=True)

    # ---------- 2. Guest books whitening (deposit) and uploads a GCash receipt ----------
    page.goto(f"{BASE}/book")
    page.click("button[role=radio]:has-text('Teeth Whitening')")
    page.wait_for_timeout(300)
    # find first day with open times
    day_buttons = page.locator("[aria-label=Date] button")
    found = False
    for i in range(1, 10):
        day_buttons.nth(i).click()
        page.wait_for_timeout(700)
        if page.locator("[aria-label='Morning times'] button, [aria-label='Afternoon times'] button").count() > 0:
            found = True
            break
    ok("whitening has open times on an upcoming day", found)
    page.locator("[aria-label='Morning times'] button, [aria-label='Afternoon times'] button").first.click()
    page.fill("input[name=fullName]", "Lia Mendoza")
    page.fill("input[name=email]", "lia.guest@example.com")
    page.fill("input[name=phone]", "09179998888")
    page.click("button:has-text('Book and hold this time')")
    page.wait_for_selector("text=Reference number", timeout=15000)
    ref2 = page.locator("p.font-display.text-2xl").inner_text().strip()
    ok("deposit booking is held, not confirmed", page.locator("text=Held until the deposit is paid").count() == 1)
    ok("payment instructions shown after booking", page.locator("text=GCash or Maya").count() >= 1)

    page.click("text=Upload my receipt")
    page.wait_for_url(re.compile(r"/track"))
    ok("track link carries only the reference, not the email", "@" not in page.url)
    page.fill("input[name=email]", "LIA.GUEST@example.com")
    page.click("button:has-text('Find booking')")
    page.wait_for_selector("text=Send your payment receipt", timeout=15000)
    page.fill("input[name=referenceNo]", "1009 876 5432")
    page.set_input_files("input[name=proof]", RECEIPT)
    page.click("button:has-text('Send receipt')")
    page.wait_for_selector("text=Receipt sent", timeout=15000)
    ok("receipt submitted → awaiting verification (not paid)", page.locator("text=Awaiting verification").count() >= 1)
    page.screenshot(path=f"{SHOTS}/04-track-after-receipt.png", full_page=True)

    page.goto(f"{BASE}/track")
    page.fill("input[name=reference]", ref1)
    page.fill("input[name=email]", "someone.else@example.com")
    page.click("button:has-text('Find booking')")
    page.wait_for_selector("text=couldn't find", timeout=10000)
    ok("tracking with the wrong email reveals nothing", page.locator("text=Juan Dela Cruz").count() == 0)

    # guest cannot open the dashboard
    page.goto(f"{BASE}/dashboard")
    ok("guest is sent to sign-in from /dashboard", "/login" in page.url)

    # ---------- 3. Front desk verifies the payment ----------
    login(page, "frontdesk@demo.smileslot.app")
    ok("receptionist lands on dashboard", page.url.rstrip("/").endswith("/dashboard"))
    page.screenshot(path=f"{SHOTS}/05-dashboard-today.png", full_page=True)
    page.goto(f"{BASE}/dashboard/payments")
    ok("payment appears in the verification queue", shows(page, f"text={ref2}"))
    page.screenshot(path=f"{SHOTS}/06-payments-queue.png", full_page=True)
    with page.expect_popup() as pop:
        page.locator(f"tr:has-text('{ref2}') >> text=View receipt").click()
    popup = pop.value
    popup.wait_for_load_state()
    ok("receipt opens through a short-lived signed URL", "token=" in popup.url)
    popup.close()
    page.locator(f"tr:has-text('{ref2}') button:has-text('Verify')").click()
    page.wait_for_selector(f"text={ref2}", state="detached", timeout=15000)
    ok("verified payment leaves the queue", True)

    page.goto(f"{BASE}/dashboard/reservations?view=all&q={ref2}")
    page.click(f"text=Lia Mendoza")
    page.wait_for_selector("text=Staff notes")
    ok("verified deposit auto-confirmed the booking", page.locator("main >> text=Confirmed").count() >= 1)
    ok("history shows who confirmed it", page.locator("text=Pending to Confirmed").count() == 1)
    page.fill("textarea[name=body]", "Prefers afternoon appointments.")
    page.click("button:has-text('Add note')")
    page.wait_for_selector("text=Note added.")
    ok("staff note added", page.locator("text=Prefers afternoon appointments.").count() == 1)
    lia_url = page.url
    page.screenshot(path=f"{SHOTS}/07-reservation-detail.png", full_page=True)

    # Walk-in booking
    page.goto(f"{BASE}/dashboard/reservations/new")
    val = page.locator("select[name=serviceId] option", has_text="Composite Filling").get_attribute("value")
    page.select_option("select[name=serviceId]", val)
    # Staff override: an early-morning time before Dr. Ana's online hours (fresh day each run).
    import datetime, random
    d3 = (datetime.date.today() + datetime.timedelta(days=random.randint(3, 40))).isoformat()
    t = random.choice(["07:00", "07:15", "07:30", "07:45", "08:00", "08:15"])
    def walk_in(name):
        page.goto(f"{BASE}/dashboard/reservations/new")
        val = page.locator("select[name=serviceId] option", has_text="Composite Filling").get_attribute("value")
        page.select_option("select[name=serviceId]", val)
        page.fill("input[name=date]", d3)
        page.fill("input[name=time]", t)
        page.fill("input[name=fullName]", name)
        page.fill("input[name=email]", "walkin@example.com")
        page.fill("input[name=phone]", "09170001111")
        page.click("button:has-text('Create booking')")
    walk_in("Walk In Patient")
    ok("walk-in booking created by front desk (outside online hours)", shows(page, "text=Booking created."))
    walkin_url = page.url.split("?")[0]
    walk_in("Second Walk In")
    ok("booking the same dentist at the same time is refused", shows(page, "text=already has an appointment at that time"))
    page.screenshot(path=f"{SHOTS}/07b-double-booking-refused.png", full_page=True)

    # Double booking attempt through the reschedule form: move walk-in onto Juan's time? use same dentist/time as Lia
    page.goto(f"{BASE}/dashboard/calendar")
    page.screenshot(path=f"{SHOTS}/08-calendar.png", full_page=True)
    ok("calendar renders appointments", shows(page, "main a[href^='/dashboard/reservations/']"))

    page.goto(f"{BASE}/dashboard/settings")
    ok("receptionist is kept out of owner settings", left(page, "/dashboard/settings"))
    page.goto(f"{BASE}/dashboard/audit")
    ok("receptionist is kept out of the audit log", left(page, "/dashboard/audit"))
    logout(ctx)

    # ---------- 4. Dentist sees only their own ----------
    login(page, "dr.marco@demo.smileslot.app")
    page.goto(f"{BASE}/dashboard/reservations?view=all")
    shows(page, "tbody a")
    page.screenshot(path=f"{SHOTS}/09-dentist-appointments.png", full_page=True)
    names = page.locator("tbody a").all_inner_texts()
    ok(f"Dr. Marco sees no other dentist's patients ({names})", "Lia Mendoza" not in names and "Walk In Patient" not in names)
    page.goto(lia_url)
    ok("Dr. Marco opening Dr. Ana's appointment by URL gets 404", shows(page, "text=/404|could not be found/"))
    page.goto(f"{BASE}/dashboard/payments")
    ok("dentist is kept out of payments", left(page, "/dashboard/payments"))
    logout(ctx)

    login(page, "dr.ana@demo.smileslot.app")
    page.goto(lia_url)
    ok("Dr. Ana can open her own patient's appointment", page.locator("text=Staff notes").count() == 1)
    ok("dentist does not see the payments panel", page.locator("h2:has-text('Payments')").count() == 0)
    page.goto(walkin_url)
    ok("dentist sees a Check in button on their appointment", shows(page, "button:has-text('Check in')"))
    page.click("button:has-text('Check in')")
    ok("dentist can check in a patient", shows(page, "main span:has-text('Checked in')"))
    ok("dentist is not offered Cancel (front desk only)", page.locator("button:has-text('Cancel')").count() == 0)
    logout(ctx)

    # ---------- 5. Owner ----------
    login(page, "owner@demo.smileslot.app")
    page.goto(f"{BASE}/dashboard/audit")
    page.screenshot(path=f"{SHOTS}/10-audit.png", full_page=True)
    ok("owner sees the audit log with the receptionist's payment verification",
       shows(page, "tr:has-text('Rhea Santos'):has-text('payment')"))
    page.goto(f"{BASE}/dashboard/settings")
    ok("owner can open settings", shows(page, "text=Booking rules"))
    page.screenshot(path=f"{SHOTS}/11-settings.png", full_page=True)
    logout(ctx)

    # ---------- 6. Patient ----------
    login(page, "patient@demo.smileslot.app")
    ok("patient lands on My bookings", shows(page, "h1:has-text('My bookings')"))
    page.goto(f"{BASE}/dashboard")
    ok("patient is kept out of the dashboard", left(page, "/dashboard"))
    logout(ctx)

    # ---------- 7. Mobile ----------
    m = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True).new_page()
    m.goto(BASE); m.screenshot(path=f"{SHOTS}/12-mobile-home.png", full_page=True)
    m.goto(f"{BASE}/book"); m.screenshot(path=f"{SHOTS}/13-mobile-book.png", full_page=True)
    overflow = m.evaluate("document.documentElement.scrollWidth > window.innerWidth")
    ok("no horizontal scrolling on mobile", not overflow)

    real_errors = [e for e in errors if "favicon" not in e]
    ok(f"no browser console errors ({real_errors[:3]})", len(real_errors) == 0)
    browser.close()

failed = [n for n, r in results if not r]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
