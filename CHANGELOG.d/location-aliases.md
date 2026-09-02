### Place aliases — 2026-09-02

*Schema: `20260902120000_add_location_aliases`*

#### Added
- **Alternate names for places.** Quick add, interaction and plan entry, and
  place search resolve aliases through an owner-scoped indexed table. Existing
  unambiguous JSON aliases migrate automatically; ambiguous claims stay intact
  for manual resolution rather than being assigned to an arbitrary place.
