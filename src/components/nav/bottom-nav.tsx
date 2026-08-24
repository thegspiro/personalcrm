"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";
import { PRIMARY_NAV, isActive, visibleNav } from "./nav-items";

export function BottomNav({ hideDating = false }: { hideDating?: boolean }) {
  const pathname = usePathname();
  const items = visibleNav(PRIMARY_NAV, hideDating);

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-lg safe-bottom lg:hidden"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-[4.25rem] min-w-0 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors",
                  active ? "text-accent-11" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    active && "bg-accent-3",
                  )}
                >
                  <Icon name={item.icon} className="size-[18px]" />
                </span>
                <span className="max-w-full truncate px-0.5">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
