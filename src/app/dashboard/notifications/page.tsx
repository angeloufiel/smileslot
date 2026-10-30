import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageHeader, Skeleton, cx } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { DeleteButton, HeaderActions } from "./controls";

export const metadata = { title: "Notifications" };

export default function NotificationsPage({ searchParams }: PageProps<"/dashboard/notifications">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Notifications searchParams={searchParams} />
    </Suspense>
  );
}

async function Notifications({ searchParams }: { searchParams: PageProps<"/dashboard/notifications">["searchParams"] }) {
  await requireStaff("/dashboard/notifications");
  const params = await searchParams;
  const onlyUnread = params.show === "unread";
  const supabase = await createClient();
  // RLS returns only this user's notifications.
  const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(200);
  const all = data ?? [];
  const unread = all.filter((n) => !n.read_at).length;
  const list = onlyUnread ? all.filter((n) => !n.read_at) : all;

  return (
    <>
      <PageHeader
        title="Notifications"
        description={unread ? `${unread} unread of ${all.length}` : all.length ? "You're all caught up." : undefined}
        actions={<HeaderActions unread={unread} total={all.length} />}
      />

      {all.length > 0 && (
        <nav aria-label="Filter" className="mb-4 flex w-fit rounded-[var(--radius-control)] bg-surface p-1 ring-1 ring-line">
          {[["All", "/dashboard/notifications", !onlyUnread], [`Unread (${unread})`, "/dashboard/notifications?show=unread", onlyUnread]].map(([label, href, active]) => (
            <Link key={String(href)} href={String(href)} aria-current={active ? "page" : undefined}
              className={cx("rounded-lg px-3 py-1.5 text-sm font-medium", active ? "bg-ink text-white" : "hover:bg-canvas")}>
              {String(label)}
            </Link>
          ))}
        </nav>
      )}

      {list.length === 0 ? (
        <EmptyState title={onlyUnread ? "No unread notifications" : "No notifications"}>
          New bookings, cancellations and payment receipts show up here.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-[var(--radius-panel)] bg-surface ring-1 ring-line">
          {list.map((n) => (
            <li key={n.id} className={cx("flex items-start gap-3 p-4", !n.read_at && "bg-cobalt-soft/40")}>
              <span aria-hidden className={cx("mt-2 h-2.5 w-2.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-cobalt")} />
              <Link href={`/dashboard/notifications/${n.id}`} className="min-w-0 flex-1 rounded-lg hover:underline focus-visible:underline">
                <span className={cx("block", n.read_at ? "font-medium" : "font-bold")}>{n.title}</span>
                {n.body && <span className="block truncate text-sm text-muted">{n.body}</span>}
                <span className="mt-1 block text-xs text-muted">
                  {formatDateTime(n.created_at)}{!n.read_at && <span className="sr-only">, unread</span>}
                </span>
              </Link>
              <DeleteButton id={n.id} label="Delete" />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
