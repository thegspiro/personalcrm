"use client";

import { InstallApp } from "@/components/pwa/install";
import { resetOfflineWorker } from "@/components/offline/offline";
import { Button } from "@/components/ui/button";

/**
 * Installing the app, after the first run.
 *
 * The wizard offers this once; this is where it lives permanently, for a second
 * phone, a new laptop, or the very likely case of having skipped it the first
 * time.
 */
export function AppSettings({ installedAt }: { installedAt: string | null }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Install on this device</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Installed, Personal CRM opens in its own window with no address bar, and gets its
          own icon. It still needs your server to be reachable — installing does not put a
          copy of your data on the device.
        </p>
        <div className="mt-3">
          <InstallApp alreadyInstalled={Boolean(installedAt)} />
        </div>

        {installedAt ? (
          <p className="mt-3 text-xs text-muted-foreground">
            You installed it on another device before. Each device installs separately.
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Offline reading</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Pages that carry nothing private keep a copy for reading without a connection, and
          say how old that copy is. Nothing is cached unless the page asks, and everything is
          wiped when you lock the app or sign out.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() => void resetOfflineWorker().finally(() => window.location.reload())}
        >
          Reset offline data
        </Button>
      </section>
    </div>
  );
}
