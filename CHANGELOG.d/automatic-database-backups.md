### Automatic database backups — 2026-09-02

*Schema: none*

#### Added
- **The container now writes a consistent MariaDB dump to `/config/backups`
  every day at 02:00 in `TZ`.** Completed dumps are compressed, published
  atomically, retained for 30 days by default, and owned by `PUID:PGID`.
- Backup scheduling, retention, minimum-free-space checks, and a tested restore
  procedure are documented. Database credentials stay in a short-lived mode
  `0600` client file instead of command arguments or logs.
