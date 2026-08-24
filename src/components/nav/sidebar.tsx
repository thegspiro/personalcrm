"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HeartHandshake } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";
import { PRIMARY_NAV, SECONDARY_NAV, isActive, visibleNav } from "./nav-items";

export function Sidebar({ hideDating = false }: { hideDating?: boolean }) {
  const pathname = usePathname();
  const primary = visibleNav(PRIMARY_NAV, hideDating).filter((item) => item.href !== "/more");

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-sidebar lg:flex">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <HeartHandshake className="size-4" />
        </div>
        <span className="text-sm font-semibold tracking-tight">Personal CRM</span>
      </div>

      <nav aria-label="Primary" className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
        <ul className="space-y-0.5">
          {primary.map((item) => (
            <SidebarLink key={item.href} item={item} active={isActive(pathname, item)} />
          ))}
        </ul>
        <div>
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            More
          </p>
          <ul className="space-y-0.5">
            {SECONDARY_NAV.map((item) => (
              <SidebarLink key={item.href} item={item} active={isActive(pathname, item)} />
            ))}
          </ul>
        </div>
      </nav>
    </aside>
  );
}

function SidebarLink({
  item,
  active,
}: {
  item: { href: string; label: string; icon: string };
  active: boolean;
}) {
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          active
            ? "bg-accent-3 text-accent-11"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Icon name={item.icon} className="size-4 shrink-0" />
        {item.label}
      </Link>
    </li>
  );
}
