import { AuthShell } from "@/components/auth/auth-shell";

/**
 * The first-run wizard runs outside the app shell.
 *
 * There is a session by this point, but no navigation: the sidebar and bottom
 * bar lead to screens that have nothing in them yet, and offering them mid-setup
 * only invites you to wander off. The pages here require a user themselves.
 */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell width="md">{children}</AuthShell>;
}
