### Places you can edit, and an optional address lookup — 2026-08-31

*Schema: `20260831205130_add_location_osm_reference`*

#### Added
- **Places can be edited.** Until now a place could only be created as a side
  effect of logging something, which made a typo permanent and left its address,
  city, region, country, phone, link and notes unreachable by anyone. A place
  now has an Edit panel, and its page shows what you put there.
- **Renaming and archiving.** Renaming requires the privacy lock to be open, so
  that a name cannot be used to probe for a place the lock is hiding. A rename
  leaves every past entry's wording alone —
  the words you typed at the time are the record. Archiving takes a place out of
  the lists while its page and visit history stay reachable, and is reversible.
  A rename onto a place you already have is refused rather than quietly merging
  the two, since two real venues can share a name.
- **An optional address lookup, off by default.** Only an administrator can turn
  it on or change where it points, because the endpoint is shared by everyone
  using the installation. Turn it on under Settings →
  Places and point it at OpenStreetMap (Nominatim) or Photon — either of them
  public, or an instance on your own network, in which case nothing leaves it.
  A place's Edit panel then gets a "Look up this address" button that
  offers candidates and, when you pick one, fills in the address, city, region,
  country and coordinates into the panel, where you can correct them before
  saving. It sends the place's name and the address you typed, only when you
  press the button — never while you type, never on a page load, and never your
  notes or who you saw there. Requests to the public OpenStreetMap service are
  spaced out to stay inside its published limit.
- **A place matched by lookup is tied to the real venue**, so its map link opens
  that exact spot rather than a search for its name.

#### Fixed
- **The map link marks the place instead of searching for it.** A place with
  coordinates was linking to a search for the digits, which returned a results
  page rather than a pin.
