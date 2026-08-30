"use client";

import * as React from "react";
import { Check, Download, Share, SquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markPwaInstalled } from "@/server/actions/onboarding";

/**
 * Installing the app to a home screen.
 *
 * The manifest and the service worker have been in place for a while, but
 * nothing ever offered the install — which on a phone is the whole difference
 * between a bookmark and something you reach for. This is that offer.
 *
 * Three browsers, three different truths:
 *
 *  - **Chromium** fires `beforeinstallprompt`. Cancel it, keep the event, and
 *    a button can raise the real install dialog later.
 *  - **iOS Safari** never fires it and has no API at all. The only honest thing
 *    is to describe where the buttons are.
 *  - **Firefox on the desktop** does neither, and pretending otherwise would
 *    mean a button that does nothing.
 *
 * So the state is worked out first and the UI follows from it, rather than
 * rendering a button and hoping.
 */

/** The Chromium-only event. Not in lib.dom, so it is described here. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallState =
  /** Still working it out — `beforeinstallprompt` can arrive a beat after load. */
  | "pending"
  /** Running from a home screen already. */
  | "installed"
  /** Chromium, prompt captured and ready to raise. */
  | "available"
  /** iOS Safari: no API, so it gets instructions. */
  | "ios"
  /** Everything else, including a browser that simply cannot install. */
  | "unsupported";

function runningStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // `navigator.standalone` is the iOS-only signal; the media query covers the rest.
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return window.matchMedia("(display-mode: standalone)").matches || iosStandalone === true;
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac, and is only told apart by having a touch screen.
  const ios = /iphone|ipod|ipad/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  if (!ios) return false;
  // Every iOS browser is Safari underneath, but only Safari itself can install.
  return !/crios|fxios|edgios|opt\//i.test(ua);
}

/**
 * Work out what this browser can actually do, and hold the install prompt if
 * there is one.
 */
export function usePwaInstall() {
  const [state, setState] = React.useState<InstallState>("pending");
  const promptRef = React.useRef<BeforeInstallPromptEvent | null>(null);

  React.useEffect(() => {
    if (runningStandalone()) {
      const installed = setTimeout(() => setState("installed"), 0);
      return () => clearTimeout(installed);
    }

    const onBeforeInstallPrompt = (event: Event) => {
      // Without this Chromium shows its own mini-infobar and the event is spent.
      event.preventDefault();
      promptRef.current = event as BeforeInstallPromptEvent;
      setState("available");
    };

    const onInstalled = () => {
      promptRef.current = null;
      setState("installed");
      void markPwaInstalled();
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // The event fires shortly after load when it fires at all. Settle on a
    // final answer rather than leaving a spinner up forever.
    const settle = setTimeout(() => {
      setState((current) =>
        current === "pending" ? (isIosSafari() ? "ios" : "unsupported") : current,
      );
    }, 1200);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      clearTimeout(settle);
    };
  }, []);

  const promptInstall = React.useCallback(async (): Promise<boolean> => {
    const event = promptRef.current;
    if (!event) return false;

    await event.prompt();
    const { outcome } = await event.userChoice;
    // A prompt can only be raised once. If it was declined, Chromium will fire
    // `beforeinstallprompt` again on a later visit.
    promptRef.current = null;
    if (outcome === "accepted") {
      setState("installed");
      void markPwaInstalled();
      return true;
    }
    setState("unsupported");
    return false;
  }, []);

  return { state, promptInstall };
}

/** Where the buttons are, for the browser that has no API. */
function IosInstructions() {
  return (
    <ol className="grid gap-2.5 text-sm">
      <li className="flex items-start gap-2.5">
        <Share className="mt-0.5 size-4 shrink-0 text-accent-11" />
        <span>
          Tap <span className="font-medium">Share</span> in Safari&apos;s bottom bar.
        </span>
      </li>
      <li className="flex items-start gap-2.5">
        <SquarePlus className="mt-0.5 size-4 shrink-0 text-accent-11" />
        <span>
          Scroll down and choose <span className="font-medium">Add to Home Screen</span>.
        </span>
      </li>
      <li className="flex items-start gap-2.5">
        <Check className="mt-0.5 size-4 shrink-0 text-accent-11" />
        <span>
          Tap <span className="font-medium">Add</span>. It opens full-screen from then on.
        </span>
      </li>
    </ol>
  );
}

/**
 * The install offer itself.
 *
 * Rendered by the first-run wizard and by Settings, which is why it says nothing
 * about where it sits — the surrounding screen supplies the heading.
 */
export function InstallApp({ alreadyInstalled = false }: { alreadyInstalled?: boolean }) {
  const { state, promptInstall } = usePwaInstall();
  const [working, setWorking] = React.useState(false);

  const onInstall = async () => {
    setWorking(true);
    try {
      await promptInstall();
    } finally {
      setWorking(false);
    }
  };

  if (state === "installed") {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-accent-3 px-3 py-2.5 text-sm text-accent-11">
        <Check className="size-4 shrink-0" />
        You&apos;re running the installed app.
      </p>
    );
  }

  if (state === "pending") {
    return <div className="h-11 animate-pulse rounded-lg bg-muted" aria-hidden />;
  }

  if (state === "available") {
    return (
      <div className="grid gap-2.5">
        <Button onClick={onInstall} loading={working} className="h-11 w-full">
          <Download className="size-4" />
          Install Personal CRM
        </Button>
        <p className="text-xs text-muted-foreground">
          Opens in its own window, with no address bar and its own icon.
        </p>
      </div>
    );
  }

  if (state === "ios") {
    return <IosInstructions />;
  }

  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">
        This browser can&apos;t install the app.{" "}
        {alreadyInstalled
          ? "You've installed it somewhere else already."
          : "Open Personal CRM in Chrome, Edge, or Safari on a phone to add it to your home screen."}
      </p>
    </div>
  );
}
