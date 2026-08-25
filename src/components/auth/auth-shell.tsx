import { HeartHandshake } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The centred, branded frame every signed-out screen sits in.
 *
 * Shared by the auth pages and the first-run wizard so the two feel like one
 * continuous flow: you create an account and the page around it never changes,
 * only what is inside it. The wizard asks for a wider column than a login form
 * needs, which is the only thing `width` exists for.
 */
export function AuthShell({
  children,
  width = "sm",
}: {
  children: React.ReactNode;
  width?: "sm" | "md";
}) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_40rem_at_50%_-10%,var(--accent-3),transparent)]"
      />
      <div className={cn("w-full", width === "md" ? "max-w-md" : "max-w-sm")}>
        <div className="mb-7 flex flex-col items-center gap-2.5 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-[color-mix(in_oklab,var(--accent-9)_35%,transparent)]">
            <HeartHandshake className="size-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Personal CRM</h1>
        </div>
        {children}
      </div>
    </div>
  );
}
