### Addresses that know where they are — 2026-09-05

*Schema: `20260905120000_add_address_coordinates_and_home_base`*

#### Added
- **A person's address can now be placed on the map, and the app can say how far
  away things are.** Every address in the app was free text: the places you save
  had coordinates, but a person's home did not, and there was nowhere to say
  where *you* live — so nothing could answer the question date planning actually
  raises, which is "somewhere near her?". An address now carries coordinates,
  Settings → Places has a home base, and both are entirely optional. An account
  that sets neither sees exactly what it saw before.
- **Distances, computed on your own machine.** A plan with a place shows how far
  it is, a person's page suggests places near them, and a place's page says how
  far it is from home. All of it is straight-line arithmetic over coordinates
  already stored — nothing is sent anywhere to produce a distance, and it works
  offline. Miles or kilometres, in Settings → Places.
- **Coordinates can always be typed by hand**, which is the only route for a
  private contact and the way to correct a bad match for anyone else.

#### Changed
- **A private contact's address is never sent to the address lookup**, whatever
  the toggle says — the promise the assisted-reading layer already makes, applied
  here for a stronger reason: a home address identifies someone more precisely
  than a name does. For everyone else only the address itself is sent: the lines,
  the city, the region, the country. Never the label, never the notes, and never
  the name of the person who lives there.
- **A place created by logging a date or saving a plan now keeps the whole
  lookup result.** The city, region, country and coordinates of an accepted
  match used to be dropped on the floor, so a place created that way could never
  be measured from anywhere. Coordinates are filled in but never overwritten:
  typing a venue's name into an interaction says *which* place you mean, not
  where it is, and a stray save must not move one you geocoded deliberately.
