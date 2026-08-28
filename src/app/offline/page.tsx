import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Offline",
  description: "Personal CRM is unavailable while this device is offline.",
};

// This document is installed with the service worker. Keep it independent of
// sessions, request data, and the database so it can always be rendered and
// safely stored on the device.
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-5 py-12">
      <section className="w-full max-w-md overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="h-1.5 bg-primary" aria-hidden="true" />
        <div className="p-6 sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <div
              className="grid size-10 place-items-center rounded-xl bg-accent-3 text-lg font-bold text-accent-11"
              aria-hidden="true"
            >
              P
            </div>
            <p className="font-semibold tracking-tight">Personal CRM</p>
          </div>

          <p className="mb-2 text-sm font-medium text-accent-11">No connection</p>
          <h1 className="text-2xl font-semibold tracking-tight">You&apos;re offline</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            This page isn&apos;t saved for offline reading. Reconnect to the internet and try again, or
            return to a section you previously saved on this device.
          </p>

          <a
            href=""
            className="mt-6 flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-accent-10"
          >
            Try again
          </a>

          <div className="mt-6 border-t pt-5">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Saved sections
            </p>
            <p className="mt-2 text-sm leading-5 text-muted-foreground">
              Only sections you opened and saved before going offline will be available.
            </p>
            <nav className="mt-3 flex gap-4 text-sm font-medium" aria-label="Previously saved sections">
              <Link className="text-accent-11 underline-offset-4 hover:underline" href="/" prefetch={false}>
                Dashboard
              </Link>
              <Link className="text-accent-11 underline-offset-4 hover:underline" href="/people" prefetch={false}>
                People
              </Link>
            </nav>
          </div>
        </div>
      </section>
    </main>
  );
}
