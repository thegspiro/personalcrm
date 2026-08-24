import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { Icon } from "@/components/nav/icon";
import { SECONDARY_NAV } from "@/components/nav/nav-items";

export const metadata: Metadata = { title: "More" };

/** The mobile overflow menu. On desktop these live in the sidebar. */
export default function MorePage() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <h2 className="text-lg font-semibold tracking-tight">More</h2>
      <ul className="grid gap-2">
        {SECONDARY_NAV.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 transition-colors hover:bg-muted/60"
            >
              <Icon name={item.icon} className="size-4 text-muted-foreground" />
              <span className="flex-1 text-sm font-medium">{item.label}</span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
