### Settings dropdowns keep what you saved — 2026-10-04

*Schema: none*

#### Fixed
- **The daily digest hour, the Defaults dropdowns and the home-base distance
  unit no longer snap back after Save.** The save always reached the database,
  but once it finished each dropdown went back to the value it had when the
  page loaded. A page reload showed the right value, but saving the same form
  again without reloading quietly wrote the old value back — which is how a
  digest hour could seem impossible to change.
