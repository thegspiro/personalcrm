### Quick add reads the place — 2026-08-31

*Schema: none*

#### Added
- **A line that names where you were now records it.** "Coffee with Sarah at
  Northside Cafe" files the venue as the place rather than leaving it in the
  title, and a venue you already have is matched to it however you capitalise or
  space it — so the same cafe does not accumulate near-duplicate entries. The
  Where field is filled in before you confirm, and stays editable.

#### Fixed
- **Quick add no longer offers to create people out of words that are not
  people.** Strangers are now worked out after the type, date and place have
  been read, so "Coffee with Sarah at Northside Cafe" stops offering to add
  contacts called "Northside" and "Cafe", and "coffee with Sarah Tuesday" stops
  offering one called "Tuesday". Those boxes arrive ticked, so confirming such a
  line quietly created the contacts.
- **Filtering the timeline by a place now finds every visit to it.** A visit
  whose typed label differed from the place's name only in spacing was matched
  by the database and then dropped again before display. Place pages gained a
  "See in timeline" link, which filters on the place itself rather than on text.
- **A place created by saving a plan appears in the Places directory
  immediately** instead of after the next change elsewhere.
