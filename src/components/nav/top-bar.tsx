"use client";

import Link from "next/link";
import { LogOut, Moon, Settings, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { logoutAction } from "@/server/actions/auth";
import { purgeOfflineCaches } from "@/components/offline/offline";
import { CommandPalette } from "./command-palette";
import { cn, initialsOf } from "@/lib/utils";
import { useHydrated } from "@/components/providers/use-hydrated";

export function TopBar({
  name,
  email,
  title,
  hideDating = false,
}: {
  name: string;
  email: string;
  title?: string;
  hideDating?: boolean;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useHydrated();
  const [signingOut, setSigningOut] = useState(false);

  const [first, ...rest] = name.split(" ");

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-lg safe-top lg:h-16 lg:px-6">
      {/* The sidebar carries the brand on desktop, so only show it here on
          mobile unless the page supplies its own title. */}
      <h1
        className={cn(
          "min-w-0 flex-1 truncate text-base font-semibold tracking-tight lg:text-lg",
          !title && "lg:sr-only",
        )}
      >
        {title ?? "Personal CRM"}
      </h1>
      {!title ? <div className="hidden flex-1 lg:block" /> : null}

      <CommandPalette hideDating={hideDating} />

      <Button
        variant="ghost"
        size="icon"
        aria-label="Toggle theme"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      >
        {mounted && resolvedTheme === "dark" ? (
          <Sun className="size-[18px]" />
        ) : (
          <Moon className="size-[18px]" />
        )}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="tap flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar className="size-8">
              <AvatarFallback>{initialsOf(first ?? name, rest.join(" "))}</AvatarFallback>
            </Avatar>
            <span className="sr-only">Account menu</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <span className="block text-sm font-medium text-foreground">{name}</span>
            <span className="block truncate text-xs">{email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <Settings />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={signingOut}
            onSelect={async () => {
              setSigningOut(true);
              // Saved pages must not outlive the session they came from.
              await purgeOfflineCaches();
              await logoutAction();
            }}
          >
            <LogOut />
            {signingOut ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
