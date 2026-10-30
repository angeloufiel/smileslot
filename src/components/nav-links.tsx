"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export type NavItem = { href: string; label: string; count?: number; exact?: boolean };

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Dashboard" className="-mx-1 flex gap-1 overflow-x-auto px-1 lg:flex-col lg:overflow-visible">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-medium",
              active ? "bg-ink text-white" : "text-ink hover:bg-canvas",
            )}
          >
            {item.label}
            {item.count ? (
              <span className={cx("rounded-full px-2 text-xs font-bold", active ? "bg-white text-ink" : "bg-sun-soft text-sun")}>
                {item.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
