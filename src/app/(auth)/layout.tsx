import { HeartHandshake } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_40rem_at_50%_-10%,var(--accent-3),transparent)]"
      />
      <div className="w-full max-w-sm">
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
