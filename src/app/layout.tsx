import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Toaster } from "sonner";
import { ThemeProvider, appearanceBootScript } from "@/components/providers/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ServiceWorkerRegistrar, ServiceWorkerUpdateNotification } from "@/components/offline/offline";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Personal CRM", template: "%s · Personal CRM" },
  description: "Keep track of the people in your life.",
  applicationName: "Personal CRM",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Personal CRM" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1115" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Set by `src/middleware.ts`, and the same value Next puts on its own
  // bootstrap scripts. Absent only if middleware did not run, in which case
  // there is no policy to satisfy either.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: appearanceBootScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          nonce={nonce}
        >
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
          <ServiceWorkerRegistrar />
          <ServiceWorkerUpdateNotification />
          <Toaster
            position="top-center"
            richColors
            closeButton
            toastOptions={{ className: "text-sm" }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
