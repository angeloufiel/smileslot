"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateReservationStatus } from "@/app/actions/dashboard";
import { ConfirmDialog } from "@/components/dialog";
import { Button, cx } from "@/components/ui";
import { ACTION_LABEL, nextStatusesFor } from "@/lib/status";
import type { AppRole, ReservationStatus } from "@/lib/types";

/** Changes that deserve a second look before they happen. */
const ASK_FIRST: Partial<Record<ReservationStatus, { title: string; message: string; reason?: string; danger: boolean }>> = {
  cancelled: { title: "Cancel this appointment?", message: "The time becomes free for other patients. This can't be undone.", reason: "Reason (the patient will see this)", danger: true },
  rejected: { title: "Reject this booking request?", message: "The patient is told their request was declined. This can't be undone.", reason: "Reason (the patient will see this)", danger: true },
  no_show: { title: "Mark as no-show?", message: "Use this when the patient didn't come. This can't be undone.", danger: true },
  completed: { title: "Mark as completed?", message: "Finish this appointment. It can't be reopened.", danger: false },
};

/**
 * One main button for the next normal step (Confirm, Check in, Start, Complete)
 * and a "More" menu for the rest. Shows only what this role may do.
 */
export function StatusButtons({ id, status, role, compact = false }: { id: string; status: ReservationStatus; role: AppRole; compact?: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<ReservationStatus | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const options = nextStatusesFor(role, status);
  const primary = options.find((s) => !ASK_FIRST[s]?.danger);
  const more = options.filter((s) => s !== primary);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const hide = () => setMenuOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [menuOpen]);

  if (options.length === 0) return compact ? <span className="text-sm text-muted">No actions</span> : null;

  async function run(next: ReservationStatus, reason = ""): Promise<string | null> {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("status", next);
    if (reason) fd.set("reason", reason);
    const result = await updateReservationStatus(fd);
    return result.ok ? null : result.error;
  }

  function choose(next: ReservationStatus) {
    setMenuOpen(false);
    setError(null);
    if (ASK_FIRST[next]) { setAsking(next); return; }
    start(async () => { const err = await run(next); if (err) setError(err); });
  }

  const size = compact ? "min-h-9 px-3 py-1.5 text-sm" : undefined;
  const ask = asking ? ASK_FIRST[asking] : undefined;

  return (
    <div className={cx("flex flex-col gap-1", compact ? "items-end" : "items-start")}>
      <div className="flex items-center gap-2">
        {primary && (
          <Button type="button" className={cx(size, compact && "min-w-28")} disabled={pending} onClick={() => choose(primary)}>
            {pending ? "Saving…" : ACTION_LABEL[primary]}
          </Button>
        )}
        {more.length > 0 && (
          <div className="relative" ref={menuRef}>
            <Button
              type="button"
              variant="secondary"
              className={size}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={pending}
              onClick={(e) => {
                // Position the menu against the window so a scrolling table can't clip it.
                const r = e.currentTarget.getBoundingClientRect();
                setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
                setMenuOpen((o) => !o);
              }}
            >
              More
              <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
            </Button>
            {menuOpen && menuPos && (
              <ul
                role="menu"
                style={{ position: "fixed", top: menuPos.top, right: menuPos.right }}
                className="z-30 min-w-48 overflow-hidden rounded-[var(--radius-control)] bg-surface py-1 shadow-lg ring-1 ring-line"
              >
                {more.map((s) => (
                  <li key={s} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => choose(s)}
                      className={cx("block w-full px-4 py-2.5 text-left text-sm hover:bg-canvas", ASK_FIRST[s]?.danger && "text-danger")}
                    >
                      {ACTION_LABEL[s]}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {error && <p role="alert" className="max-w-64 text-sm text-danger">{error}</p>}

      {asking && ask && (
        <ConfirmDialog
          open
          onClose={() => setAsking(null)}
          title={ask.title}
          message={ask.message}
          reasonLabel={ask.reason}
          confirmLabel={ACTION_LABEL[asking]}
          tone={ask.danger ? "danger" : "primary"}
          onConfirm={(reason) => run(asking, reason)}
        />
      )}
    </div>
  );
}
