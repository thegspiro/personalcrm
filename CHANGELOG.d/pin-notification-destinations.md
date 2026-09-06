### Notification destinations cannot change after validation — 2026-09-02

*Schema: none*

#### Fixed

- Resolve every notification hostname and pin HTTP and SMTP connections to the validated public address, preventing member channels from reaching non-public networks through DNS rebinding.
- Saving a channel no longer requires its hostname to resolve, so a channel can still be configured while DNS is unavailable or before an internal name exists; the destination is checked again, and refused, immediately before every delivery.
