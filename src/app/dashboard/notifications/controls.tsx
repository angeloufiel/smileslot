"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  deleteAllNotifications, deleteNotification, markAllNotificationsRead, markNotificationRead,
} from "@/app/actions/dashboard";
import { ConfirmDialog } from "@/components/dialog";
import { Button } from "@/components/ui";

export function HeaderActions({ unread, total }: { unread: number; total: number }) {
  const [pending, start] = useTransition();
  const [askDeleteAll, setAskDeleteAll] = useState(false);
  if (total === 0) return null;
  return (
    <>
      {unread > 0 && (
        <Button variant="secondary" disabled={pending} onClick={() => start(() => markAllNotificationsRead())}>
          Mark all as read
        </Button>
      )}
      <Button variant="danger" onClick={() => setAskDeleteAll(true)}>Delete all</Button>
      <ConfirmDialog
        open={askDeleteAll}
        onClose={() => setAskDeleteAll(false)}
        title={`Delete all ${total} notifications?`}
        message="This only clears your notification list. Bookings and payments are not affected."
        confirmLabel="Delete all"
        tone="danger"
        onConfirm={async () => {
          const r = await deleteAllNotifications();
          return r.ok ? null : r.error;
        }}
      />
    </>
  );
}

export function DeleteButton({ id, label = "Delete", redirectTo }: { id: string; label?: string; redirectTo?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await deleteNotification(id);
            if (!r.ok) setError(r.error);
            else if (redirectTo) router.push(redirectTo);
          })
        }
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-danger hover:bg-danger-soft disabled:opacity-50"
      >
        <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" />
        </svg>
        {pending ? "Deleting…" : label}
      </button>
      {error && <span role="alert" className="text-sm text-danger">{error}</span>}
    </>
  );
}

/** Opening a notification marks it as read. */
export function MarkRead({ id, unread }: { id: string; unread: boolean }) {
  useEffect(() => {
    if (unread) void markNotificationRead(id);
  }, [id, unread]);
  return null;
}
