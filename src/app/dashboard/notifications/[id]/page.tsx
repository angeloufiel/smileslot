import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge, ButtonLink, Panel, Skeleton } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { DeleteButton, MarkRead } from "../controls";

export const metadata = { title: "Notification" };

const KIND: Record<string, { label: string; tone: "info" | "warning" | "danger" | "success" | "neutral"; action: string }> = {
  "reservation.new": { label: "New booking", tone: "info", action: "Open the booking" },
  "reservation.cancelled": { label: "Cancellation", tone: "danger", action: "Open the booking" },
  "payment.submitted": { label: "Payment to verify", tone: "warning", action: "Go to payments" },
};

export default function NotificationPage({ params }: PageProps<"/dashboard/notifications/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <NotificationDetail params={params} />
    </Suspense>
  );
}

async function NotificationDetail({ params }: { params: PageProps<"/dashboard/notifications/[id]">["params"] }) {
  await requireStaff("/dashboard/notifications");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  // RLS: someone else's notification simply isn't found.
  const { data: n } = await supabase.from("notifications").select("*").eq("id", id).maybeSingle();
  if (!n) notFound();
  const kind = KIND[n.type] ?? { label: "Update", tone: "neutral" as const, action: "Open" };

  return (
    <>
      <MarkRead id={n.id} unread={!n.read_at} />
      <p className="mb-2 text-sm"><Link href="/dashboard/notifications" className="text-cobalt hover:underline">Notifications</Link></p>
      <Panel className="max-w-2xl">
        <Badge tone={kind.tone}>{kind.label}</Badge>
        <h1 className="mt-3 text-2xl font-bold">{n.title}</h1>
        <p className="mt-1 text-sm text-muted">{formatDateTime(n.created_at)}</p>
        {n.body && <p className="mt-4 text-lg whitespace-pre-line">{n.body}</p>}
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
          {n.link && <ButtonLink href={n.link}>{kind.action}</ButtonLink>}
          <ButtonLink href="/dashboard/notifications" variant="secondary">Back to all</ButtonLink>
          <span className="ml-auto"><DeleteButton id={n.id} redirectTo="/dashboard/notifications" /></span>
        </div>
      </Panel>
    </>
  );
}
