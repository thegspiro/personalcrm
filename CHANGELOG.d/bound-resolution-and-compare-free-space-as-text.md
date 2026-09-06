### Delivery budgets, tag races and disk-space arithmetic — 2026-09-03

*Schema: none*

#### Fixed
- **A stalled resolver counts against the delivery deadline.** The budget began
  only once the destination had been looked up, so resolution itself was
  unbounded — and a slow answer then handed the transport a fresh full budget
  on top. A "total" deadline that starts after the first network round trip is
  not one, and a send could still outlive the lease it exists to fit inside.
- **Creating or renaming a tag survives losing a race.** Two tabs can both pass
  the name check before either write commits; the loser met the unique key as a
  server error instead of the ordinary "that name is taken" it would have got a
  moment earlier.
- **The free-space guard cannot be defeated by how the number is written.** A
  very large `BACKUP_MIN_FREE_MB` overflowed the shell's fixed-width arithmetic
  so that the comparison came out false, skipping the guard and starting a dump
  on a full disk — the same outcome a leading zero produced before. The two
  values are compared as decimal strings now, which has neither failure.
- **A backup can reach a database named by an IPv6 address.** `[2001:db8::1]`
  keeps its brackets when a URL is parsed, because there they separate the host
  from the port; written into the client options they are part of the name, so
  the application connected happily while every scheduled dump failed.
