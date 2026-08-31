### Privacy locking follows protected activity — 2026-08-31

*Schema: none*

#### Fixed

- **The privacy lock now closes after 15 minutes without protected use.** Dating
  views, private-capable reads, and guarded writes extend an unlocked server
  session through a throttled heartbeat; generic browsing does not. When the
  deadline passes, sensitive rendered content and protected offline state are
  removed immediately, while every subsequent read and write remains subject
  to the server-side lock.
