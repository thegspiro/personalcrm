### Sensitive pages resist browser and intermediary storage — 2026-08-31

*Schema: none*

#### Changed
- **Dating, unlock and settings responses opt out of caching**, so a page seen
  before the privacy lock closed is not held in a browser or proxy cache
  afterwards.
- **Baseline protection headers are sent on every response** — clickjacking,
  referrer, MIME-sniffing and browser-permissions. HSTS stays with the proxy
  that terminates TLS, since it is the only part that knows whether a given
  install is served over HTTPS.
