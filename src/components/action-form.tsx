"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { Alert } from "@/components/ui";
import type { ActionResult } from "@/lib/types";

/**
 * A form that calls a Server Action returning ActionResult and shows the
 * outcome inline. Field errors are exposed to children via a render prop.
 */
export function ActionForm({
  action, children, className, resetOnSuccess = false,
}: {
  action: (fd: FormData) => Promise<ActionResult<unknown>>;
  children: (state: { pending: boolean; errors: Record<string, string> }) => ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const ref = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={ref}
      className={className}
      noValidate
      action={(fd) =>
        start(async () => {
          const r = await action(fd);
          setResult(r);
          if (r.ok && resetOnSuccess) ref.current?.reset();
        })
      }
    >
      {result && !result.ok && <div className="mb-3"><Alert>{result.error}</Alert></div>}
      {result?.ok && result.message && <div className="mb-3"><Alert tone="success">{result.message}</Alert></div>}
      {children({ pending, errors: result && !result.ok ? result.fieldErrors ?? {} : {} })}
    </form>
  );
}
