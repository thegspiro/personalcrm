"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * What a route shows when its render threw.
 *
 * Shared by every `error.tsx` so the four boundaries cannot drift into four
 * different-looking failures, and so each one stays short enough to read.
 *
 * The digest is surfaced deliberately. In production React replaces the real
 * message with a generic one and keeps only that hash, which is also what Next
 * writes to the server log beside the stack — so showing it is the only thing
 * that lets somebody reporting a problem and somebody reading the container
 * log discover they are talking about the same failure.
 */
export function ErrorState({
  title = "Something went wrong",
  description = "That page could not be loaded. Trying again often works — the data itself is untouched.",
  digest,
  onRetry,
  homeHref = "/",
  homeLabel = "Back to home",
  className,
}: {
  title?: string;
  description?: string;
  digest?: string;
  onRetry?: () => void;
  homeHref?: string;
  homeLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-6 text-center",
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <TriangleAlert className="size-6" />
      </div>
      <div className="grid gap-1">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onRetry ? <Button onClick={onRetry}>Try again</Button> : null}
        <Button asChild variant="outline">
          <Link href={homeHref}>{homeLabel}</Link>
        </Button>
      </div>
      {digest ? (
        <p className="text-xs text-muted-foreground">
          Reference <code className="font-mono">{digest}</code> — quote this if you check the logs.
        </p>
      ) : null}
    </div>
  );
}
