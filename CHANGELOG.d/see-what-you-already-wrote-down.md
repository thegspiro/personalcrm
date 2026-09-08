### See what you already wrote down — 2026-09-08

*Schema: none*

#### Added
- **A plan's checklist is on the plan.** You could fill in "reserve or buy
  tickets, check travel time, agree on budget" while saving something to do, and
  then the row said nothing about any of it — the one question the list exists to
  answer, *is this booked yet*, needed the edit form opened to read. Each row now
  carries a `Checklist · 2 of 5` line, and the items tick straight from there —
  and the list stays open while you work down it. Something you have arranged
  shows its preparation open to begin with; an idea nobody has picked a day for
  keeps it folded away until you ask.
- **A plan's venue opens on a map.** A plan whose venue matched a place you have
  been drew a map pin beside the distance — an icon that looked like a link and
  was not. It is a link now, the same one a logged date has had, and it works
  even before the place has coordinates. A venue you only ever typed is
  unchanged.
- **Plans you have finished can be looked back up.** Ticking something off took
  it off the list with nowhere to find it again — not on the page, not by any
  address you could type. "Including done" on both Things to do and Date ideas
  shows the closed ones, marked as done or archived, with "Back on the list" to
  reopen one. Reopening drops the plan's pointer at the outing it recorded; the
  outing itself stays in your timeline, so nothing that happened is undone by
  changing your mind about the plan.
- **Their profile links, and love languages.** Both have been columns in the
  database since the beginning with nothing anywhere that could write them.
  Dating profiles now take up to twenty labelled links — the app you met on, the
  page you were sent — and the five love languages as tickboxes, shown with the
  rest of the profile. Links must start `http://` or `https://`; anything else is
  refused rather than quietly dropped.

#### Fixed
- **A love language, once given, can now be taken back.** Saving with none
  selected left whatever was stored exactly as it was, so the answer could be
  changed but never cleared. It clears now — and a save from anywhere that does
  not ask about them still leaves them alone, which is the distinction that was
  missing.
- **Date ideas say when the list has been cut.** The dating page fetched at most
  two hundred and showed whatever came back with no notice, so an account past
  that had ideas silently missing. It now says so, as Things to do already did.
