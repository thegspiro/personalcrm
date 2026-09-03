"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { useAction, useAddAction } from "@/components/form/use-action";
import {
  changePassword,
  revokeAllSessions,
  revokeSession,
  updateDisplayName,
  updateEmail,
} from "@/server/actions/account";
import type { SafeSession } from "@/server/auth/session";

export function AccountSettings({
  name,
  email,
  sessions,
  timezone,
}: {
  name: string;
  email: string;
  sessions: SafeSession[];
  timezone: string;
}) {
  // The account's timezone, not the container's and not the browser's, which
  // disagree often enough to put a session on the wrong calendar day. The
  // locale is fixed for the same reason the reminder settings fix theirs:
  // this is rendered on the server and hydrated in the browser, and a locale
  // that differs between the two is a mismatch in the markup.
  const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: timezone });
  const submit = useAddAction();
  const run = useAction();
  return (
    <div className="grid gap-4">
      <section className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">Profile</h3>
        <form
          action={submit(updateDisplayName, () => {}, "Display name updated")}
          className="mt-3 grid gap-3"
        >
          <Field label="Display name" htmlFor="account-name">
            <Input
              id="account-name"
              name="name"
              defaultValue={name}
              maxLength={120}
            />
          </Field>
          <div>
            <SubmitButton size="sm">Save name</SubmitButton>
          </div>
        </form>
        <form
          action={submit(updateEmail, () => {}, "Email updated")}
          className="mt-4 grid gap-3 border-t pt-4"
        >
          <Field label="Email" htmlFor="account-email">
            <Input
              id="account-email"
              name="email"
              type="email"
              defaultValue={email}
            />
          </Field>
          <Field
            label="Current password"
            htmlFor="email-password"
            hint="Required to protect your sign-in address."
          >
            <Input
              id="email-password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <div>
            <SubmitButton size="sm">Change email</SubmitButton>
          </div>
        </form>
      </section>
      <section className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">Password</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Changing it signs out every other device and closes the privacy unlock
          on this device. This device stays signed in.
        </p>
        <form
          action={submit(changePassword, () => {}, "Password changed")}
          className="mt-3 grid gap-3"
        >
          <Field label="Current password" htmlFor="password-current">
            <Input
              id="password-current"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Field
            label="New password"
            htmlFor="password-new"
            hint="At least 10 characters, including a letter and a number or symbol."
          >
            <Input
              id="password-new"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label="Confirm new password" htmlFor="password-confirm">
            <Input
              id="password-confirm"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
            />
          </Field>
          <div>
            <SubmitButton size="sm">Change password</SubmitButton>
          </div>
        </form>
      </section>
      <section className="rounded-xl border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Signed-in devices</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Session tokens are never shown.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void run(revokeAllSessions, "Other sessions revoked")
            }
          >
            Revoke all others
          </Button>
        </div>
        <div className="mt-3 grid gap-2">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex min-w-0 items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {session.userAgent || "Unknown device"}
                  {session.current ? " · This device" : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  Created {when.format(session.createdAt)} · expires{" "}
                  {day.format(session.expiresAt)}
                  {session.ip ? ` · ${session.ip}` : ""}
                </p>
              </div>
              {!session.current ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void run(() => revokeSession(session.id), "Session revoked")
                  }
                >
                  Revoke
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">Password recovery</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          No recovery link is available yet. A safe self-hosted flow needs a
          trusted mail channel or an explicit administrator-assisted mechanism;
          Personal CRM does not use security questions and never prints reset
          tokens in logs.
        </p>
      </section>
    </div>
  );
}
