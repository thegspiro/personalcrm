### A privacy lock that notices when you leave — 2026-08-31

*Schema: none*

#### Changed
- **The privacy PIN now re-locks after 15 minutes of actual inactivity.** Using
  the app keeps an unlocked session open, while walking away promptly covers
  already-rendered private content; a new header control locks it immediately.
- **Sensitive pages resist browser and intermediary storage.** Dating, unlock,
  and settings responses opt out of caching, alongside baseline clickjacking,
  referrer, MIME-sniffing, permissions, and HTTPS transport protections.
