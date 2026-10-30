import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 font-display text-lg font-bold whitespace-nowrap">
          <ToothMark />
          <span>Harborview Dental</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 text-sm font-medium sm:gap-2">
          <Link href="/track" className="hidden rounded-lg px-3 py-2 hover:bg-canvas sm:inline-block">Find my booking</Link>
          <Suspense fallback={<span className="w-20" />}>
            <AccountLink />
          </Suspense>
          <Link href="/book" className="rounded-[var(--radius-control)] bg-cobalt px-4 py-2 font-semibold whitespace-nowrap text-white hover:bg-cobalt-dark">
            Book now
          </Link>
        </nav>
      </div>
    </header>
  );
}

async function AccountLink() {
  const user = await getCurrentUser();
  if (!user) return <Link href="/login" className="hidden rounded-lg px-3 py-2 hover:bg-canvas sm:inline-block">Sign in</Link>;
  const href = user.role === "patient" ? "/my/bookings" : "/dashboard";
  return (
    <Link href={href} className="hidden rounded-lg px-3 py-2 hover:bg-canvas sm:inline-block">
      {user.role === "patient" ? "My bookings" : "Dashboard"}
    </Link>
  );
}

export function ToothMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--color-cobalt)" />
      <path
        d="M10.5 9c-2 0-3.5 1.7-3.5 4 0 2.6 1.3 4.2 2 6.8.5 2 .8 4.2 2.2 4.2 1.6 0 1.6-3.7 2.3-5.4.3-.7.7-1 1.5-1h1c.8 0 1.2.3 1.5 1 .7 1.7.7 5.4 2.3 5.4 1.4 0 1.7-2.2 2.2-4.2.7-2.6 2-4.2 2-6.8 0-2.3-1.5-4-3.5-4-1.7 0-2.6 1-5.5 1s-3.8-1-5.5-1Z"
        fill="#fff"
      />
    </svg>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 px-4 py-6 text-sm text-muted sm:px-6">
        <p>Harborview Dental Clinic is a fictional demo clinic.</p>
        <p>
          SmileSlot booking system, built with Next.js, TypeScript and Supabase.{" "}
          <Link href="/login" className="underline underline-offset-2 hover:text-ink">Staff sign in</Link>
        </p>
      </div>
    </footer>
  );
}
