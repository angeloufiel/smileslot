import Link from "next/link";
import { Suspense } from "react";
import { markAllNotificationsRead } from "@/app/actions/dashboard";
import { Button, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Notifications />
    </Suspense>
  );
}

async function Notifications() {
  await requireStaff("/dashboard/notifications");
  const supabase = await createClient();
  // RLS returns only this user's notifications.
  const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(100);
  const unread = (data ?? []).filter((n) => !n.read_at).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description={unread ? `${unread} unread` : "You're all caught up."}
        actions={unread > 0 && <form action={markAllNotificationsRead}><Button variant="secondary" type="submit">Mark all as read</Button></form>}
      />
      {!data?.length ? <EmptyState title="No notifications yet">New bookings, cancellations and payment receipts show up here.</EmptyState> : (
        <ul className="divide-y divide-line rounded-[var(--radius-panel)] bg-surface ring-1 ring-line">
          {data.map((n) => (
            <li key={n.id} className={`flex gap-3 p-4 ${n.read_at ? "" : "bg-cobalt-soft/40"}`}>
              <span aria-hidden className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-cobalt"}`} />
              <div className="min-w-0">
                <p className="font-semibold">{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</p>
                {n.body && <p className="text-sm text-muted">{n.body}</p>}
                <p className="mt-1 text-xs text-muted">{formatDateTime(n.created_at)}{!n.read_at && <span className="sr-only">, unread</span>}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
