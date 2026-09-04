### Say why a test send failed, once the address is known good — 2026-09-03

*Schema: none*

#### Changed
- **"Send a test" now tells you what went wrong, unless saying so would give
  away your network.** It used to answer everyone but an administrator with the
  same sentence however it failed, so nobody could tell a rejected address from
  a misspelt one — deliberately, because that difference is a way to probe
  internal names. The silence now covers only that part. Once the destination
  has been checked and found to be a public address, the real reason comes back:
  a refused connection, a rejected token, an endpoint answering 500. That is
  where the detail was worth having, and it gives nothing away, because a
  non-administrator is never allowed any other kind of address in the first
  place.
