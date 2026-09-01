### Reading a line, and reading an address — 2026-09-01

*Schema: none*

#### Fixed
- **A stray double space no longer loses a person or a type.** "Coffee with
  Sarah  Whitfield" now recognises Sarah rather than offering to create her a
  second time, and "Video  call" is still a video call. Every other reader
  already folded runs of whitespace away; these two compared a literal space, so
  one extra keystroke turned a known name into a stranger.
- **Searching the timeline finds a visit by the place's current name.** A place
  renamed since the visit keeps the words you typed at the time on the
  interaction itself — the search matched the new name in the database and then
  dropped the row again before display.
- **A looked-up address stores the street, not the whole display line.** It was
  storing "Northside Cafe, Wilson Blvd, Arlington, Virginia" as the address,
  which then repeated the city and region printed directly underneath it, and
  repeated them again in the map link.
- **A place's link field only accepts `http://` and `https://`.** It is rendered
  as a link, so a `javascript:` address in it was a stored script waiting to be
  clicked. The endpoint settings already held this line.
- **A model-suggested venue is held to the same rules as one you typed.** The
  assisted reading matched type names and dates against the raw text rather than
  the folded form, so a venue named after one of your interaction types — or
  after a month — could slip past guards the local reader applies.
