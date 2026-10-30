"use client";

import { useState, useTransition } from "react";
import { updateReservationStatus } from "@/app/actions/dashboard";
import { Button, cx } from "@/components/ui";
import { ACTION_LABEL, NEEDS_REASON, nextStatusesFor } from "@/lib/status";
import type { AppRole, ReservationStatus } from "@/lib/types";

/** Shows only the status changes this role may make from the current status. */
export function StatusButtons({ id, status, role, compact = false }: { id: string; status: ReservationStatus; role: AppRole; compact?: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const options = nextStatusesFor(role, status);
  if (options.length === 0) return null;

  function change(next: ReservationStatus) {
    let reason: string | null = null;
    if (NEEDS_REASON.includes(next)) {
      reason = prompt(next === "rejected" ? "Reason for rejecting (the patient will see this):" : "Reason for cancelling (the patient will see this):");
      if (!reason?.trim()) return;
    }
    const fd = new FormData();
    fd.set("id", id);
    fd.set("status", next);
    if (reason) fd.set("reason", reason.trim());
    setError(null);
    start(async () => {
      const result = await updateReservationStatus(fd);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className={cx("flex flex-wrap items-center gap-2", compact && "justify-end")}>
      {options.map((next) => (
        <Button
          key={next}
          type="button"
          variant={["cancelled", "rejected", "no_show"].includes(next) ? "danger" : next === options[0] ? "primary" : "secondary"}
          className={compact ? "min-h-9 px-3 py-1.5 text-xs" : undefined}
          disabled={pending}
          onClick={() => change(next)}
        >
          {ACTION_LABEL[next]}
        </Button>
      ))}
      {error && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
    </div>
  );
}
