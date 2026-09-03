### Account and session security — 2026-09-02

*Schema: none*

#### Added
- **Account management in Settings.** Change your display name, verified email
  address, or password, and review or revoke signed-in devices without exposing
  session tokens.

#### Changed
- **A password change now ends every other session and closes the current
  session's privacy unlock.** The device making the change remains signed in,
  making the security boundary explicit rather than leaving old devices open.
