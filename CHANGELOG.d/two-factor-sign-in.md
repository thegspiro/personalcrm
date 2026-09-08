### A second factor at sign-in — 2026-09-06

*Schema: `20260906140000_add_two_factor`*

#### Added
- **Two-factor sign-in, from Settings → Account.** Ask for a six-digit code from
  an authenticator app as well as your password. Optional, per account, and off
  until you turn it on — nothing about the rest of the app changes, because it
  stands in front of signing in rather than inside anything.
- **Ten single-use recovery codes**, shown once when you finish setting it up.
  Each works in place of a code from the app if the phone is lost, and each
  works exactly once. You can replace the whole set at any time, which
  invalidates the old ones.
- **Setting it up takes two steps on purpose.** The key is shown, and the second
  factor is not switched on until a code from your app proves it holds the same
  key. A mistyped key therefore costs you nothing; switching it on before that
  proof is how people lock themselves out of an app with no password recovery.

#### Changed
- **Turning two-factor off signs out your other devices.** They were signed in
  under the old rules, so the change takes effect everywhere rather than only
  where you made it. Beginning setup, replacing the recovery codes and turning
  it off each ask for your password again.

#### Notes
- Setting up shows a scannable code, the key for typing in, and a link that
  opens an authenticator directly on a phone — whichever suits the device you
  have. If the code cannot be drawn for any reason, the key alone still works.
- Rotating `AUTH_SECRET` makes the stored key unreadable and sign-in will refuse
  the codes from your app. Your recovery codes are the way back — one more
  reason to keep them somewhere other than the phone.
