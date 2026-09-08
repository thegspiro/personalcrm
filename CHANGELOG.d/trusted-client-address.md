### Sign-in throttling that a header cannot switch off — 2026-09-06

*Schema: none*

#### Fixed
- **A single header no longer buys unlimited password guesses.** Repeated wrong
  passwords back off per email address and client, but the client was read from
  the front of `X-Forwarded-For` — the part the caller writes — so varying it
  handed out a fresh allowance on every request and the backoff never bit. The
  client is now taken from the entry your own reverse proxy appended, counted
  from the end of the chain, which the caller cannot write. Padding the header
  only lengthens the chain and moves nothing.

#### Added
- **`TRUSTED_PROXY_HOPS`**, the number of reverse proxies in front of the app.
  It defaults to `0`, which ignores forwarded headers entirely — correct for an
  install reached directly, since legitimate traffic to one carries none. Set it
  to `1` behind a single proxy. A misconfigured value fails closed rather than
  falling back to the caller's own entry.

#### Changed
- **With no trusted proxy, throttling now counts per email address** rather than
  per unverifiable client. This is what makes it effective at all, and the
  trade-off is stated rather than hidden: somebody who can reach your sign-in
  page can hold one account in backoff. Setting `TRUSTED_PROXY_HOPS` behind a
  real proxy restores per-client counting and removes that. The sign-in message
  still never says whether an address has an account behind it.
