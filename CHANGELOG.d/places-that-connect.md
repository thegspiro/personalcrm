### Places that connect — 2026-09-08

*Schema: `20260908120000_add_life_event_place`*

#### Added
- **Every box that asks where something happened now offers the places you have
  already been.** Logging an interaction, editing one, adding a plan, logging a
  date and quick add all show your places with how often you have been and when
  you were last there — so the one you mean is a tap rather than a retype. You
  can still type a name that is new; nothing is restricted to the list.
- **Significant moments can name a place.** A move, a wedding or a first meeting
  now records where it happened, and it lands on the same place an interaction
  naming that venue would. A place known only through a significant moment shows
  up in Places like any other, unless the person it belongs to is private.
- **A contact's address can be copied from a place you have been.** Available
  for private contacts too, since nothing is sent anywhere to do it — until now
  they had no assisted way to fill an address at all.
- **The city, state and country boxes suggest what you have already written
  down**, so the same town stops being spelled three ways.

#### Fixed
- **Near-miss venue names no longer split one place in two.** Typing "Northside
  Coffee" for a place saved as "Northside Cafe" quietly created a second place,
  scattering a person's history across two entries and two map pins. Existing
  duplicates are not merged automatically — you can merge them yourself by
  renaming one to match, or by adding the other spelling as an alias.
- **An address no longer keeps a stale map pin.** Accepting a looked-up match
  and then correcting its coordinates by hand kept the original reference, so
  the map link opened the place you had just said was wrong.
