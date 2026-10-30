import Link from "next/link";
import { signOutAction } from "@/app/actions/auth";
import { ToothMark } from "@/components/site-header";
import { NavLinks, type NavItem } from "@/components/nav-links";
import { isFrontDesk, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { humanize } from "@/lib/format";

export async function DashboardNav() {
  const user = await requireStaff();
  const supabase = await createClient();
  const frontDesk = isFrontDesk(user.role);

  const [{ count: unread }, { count: toVerify }] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    frontDesk
      ? supabase.from("payments").select("id", { count: "exact", head: true }).eq("status", "awaiting_verification")
      : Promise.resolve({ count: 0 }),
  ]);

  const items: NavItem[] = [
    { href: "/dashboard", label: "Today", exact: true },
    { href: "/dashboard/reservations", label: "Appointments" },
    { href: "/dashboard/calendar", label: "Calendar" },
    ...(frontDesk ? [{ href: "/dashboard/payments", label: "Payments", count: toVerify ?? 0 }] : []),
    { href: "/dashboard/patients", label: "Patients" },
    ...(frontDesk ? [{ href: "/dashboard/services", label: "Services" }, { href: "/dashboard/schedule", label: "Hours & closures" }] : []),
    { href: "/dashboard/notifications", label: "Notifications", count: unread ?? 0 },
    ...(user.role === "owner" ? [{ href: "/dashboard/settings", label: "Settings & staff" }, { href: "/dashboard/audit", label: "Audit log" }] : []),
  ];

  return (
    <div className="flex h-full flex-col gap-4">
      <Link href="/dashboard" className="flex items-center gap-2.5 px-2 font-display text-lg font-bold">
        <ToothMark /> Harborview
      </Link>
      <NavLinks items={items} />
      <div className="mt-auto hidden border-t border-line px-2 pt-4 text-sm lg:block">
        <p className="font-semibold">{user.fullName || user.email}</p>
        <p className="text-muted">{humanize(user.role)}</p>
        <div className="mt-3 flex gap-3">
          <Link href="/" className="text-cobalt hover:underline">Public site</Link>
          <form action={signOutAction}><button className="text-cobalt hover:underline" type="submit">Sign out</button></form>
        </div>
      </div>
    </div>
  );
}
