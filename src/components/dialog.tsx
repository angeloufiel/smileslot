"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Alert, Button } from "@/components/ui";

/**
 * In-app dialog built on the native <dialog> element: it traps focus, closes
 * with Esc, and looks like the rest of the app (no "site says…" browser box).
 */
export function Dialog({
  open, onClose, title, children, wide = false,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }} // click on the backdrop
      className={`m-auto w-[calc(100%-2rem)] ${wide ? "max-w-xl" : "max-w-md"} rounded-[var(--radius-panel)] bg-surface p-0 text-ink shadow-2xl ring-1 ring-line backdrop:bg-ink/40`}
    >
      {open && (
        <div className="p-6">
          <h2 id={titleId} className="text-xl font-bold">{title}</h2>
          <div className="mt-3">{children}</div>
        </div>
      )}
    </dialog>
  );
}

type Tone = "primary" | "danger";

/**
 * Ask before doing something. Optionally asks for a reason the patient will see.
 * `onConfirm` returns an error message to show, or null when it worked.
 */
export function ConfirmDialog({
  open, onClose, title, message, confirmLabel, tone = "primary", reasonLabel, reasonPlaceholder, onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  tone?: Tone;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  onConfirm: (reason: string) => Promise<string | null>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reasonId = useId();

  function close() {
    if (busy) return;
    setReason("");
    setError(null);
    onClose();
  }

  async function confirm() {
    if (reasonLabel && !reason.trim()) {
      setError("Please write a short reason.");
      return;
    }
    setBusy(true);
    setError(null);
    const err = await onConfirm(reason.trim());
    setBusy(false);
    if (err) setError(err);
    else { setReason(""); onClose(); }
  }

  return (
    <Dialog open={open} onClose={close} title={title}>
      {message && <div className="text-muted">{message}</div>}
      {reasonLabel && (
        <div className="mt-4 space-y-1.5">
          <label htmlFor={reasonId} className="block text-sm font-medium">{reasonLabel}</label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder={reasonPlaceholder}
            autoFocus
            className="min-h-24 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2.5 text-base focus:border-cobalt focus:ring-2 focus:ring-cobalt/25 focus:outline-none"
          />
        </div>
      )}
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={close} disabled={busy}>Go back</Button>
        <Button
          type="button"
          variant={tone === "danger" ? "danger" : "primary"}
          className={tone === "danger" ? "bg-danger text-white ring-0 hover:bg-danger/90" : undefined}
          onClick={confirm}
          disabled={busy}
          autoFocus={!reasonLabel}
        >
          {busy ? "Working…" : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
