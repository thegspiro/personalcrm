### Scheduling something, and closing it out — 2026-09-05

*Schema: `Plan.completionKey`, nullable, unique per owner*

#### Added
- **A plan can be scheduled.** "Schedule it" on anything in Things to do sets the
  day, the time and who it is with, and marks it planned. Something saved against
  nobody in particular is offered on everyone's page, so scheduling one *with*
  someone copies it and leaves the original on the list for next time — the copy
  starts with a clean checklist, because inherited ticks would claim a booking
  nobody made. Untick "Keep this in Things to do" to move it instead.
- **Finishing a shared idea keeps it on the list.** Something saved against
  nobody is offered on everyone's page, so ticking it off on one person's page
  files that evening against them and leaves the idea itself where it was — the
  same rule scheduling already follows. Ticking the same idea off twice for the
  same person on the same day records it once, whether that is a double click, a
  second tab or a resent request; the same evening in July is a new one.
- **Marking something done now records what it became.** It writes the outing
  into your timeline and points the plan at it, so "we did this on the 4th"
  survives. Before, only a date logged through the dating pages did that; a hike
  with a friend became a status and nothing else. The day and time already on the
  plan are used, so a plan you scheduled for Friday and tick off on Sunday is
  still filed under Friday — and your keep-in-touch cadence reads it as the day
  it happened, not the day you got round to ticking it.

#### Fixed
- **"Plan this again" now copies where it was.** The tickbox wrote to a field the
  save had stopped reading, so nothing was copied while the box looked ticked. The
  city now reaches the place itself, filling in a blank one and never replacing an
  address somebody has already written down for that venue.
- **Arranging something two ways at once no longer loses one of them.** Two
  stale forms scheduling the same shared idea with different people would both
  report success, and the second quietly took the plan off the first person.
- **A venue that belongs to another account is no longer copied onto your
  outing.** A plan restored from a backup could point at a place that is not
  yours; finishing it copied that pointer into your timeline, where the entry
  silently lost its venue and a deletion over there could reach into it. The
  name is kept, the stray pointer is not.
- **A shared idea arranged for nobody goes back on the list once it happens.**
  Scheduling one with "Nobody yet" and later ticking it off on somebody's page
  left the idea itself still showing that day, so a spent evening kept appearing
  as an outstanding arrangement on everyone's list. It returns to being an idea;
  the day stays on the record of what actually happened.
- **A closed idea cannot be finished a second time.** Ticking off something
  already done or archived — from a stale page, or a resent request — filed
  another evening from it.
- **Moving an evening in one tab no longer lets another tab file the old one.**
  Ticking a plan off from a stale page recorded it on the day it used to be set
  for, and closed out the day it had just been moved to.
- **A category belonging to another account is no longer copied either.** The
  same restore that could leave a stray venue pointer could leave a stray
  category, which would have shown that account's label and colour on the copy.
- **Moving only the time of a shared arrangement is no longer overwritten.**
  Ticking it off from a page loaded before the move recorded the old time and
  wiped the new one.
- **A length changed in another tab survives being scheduled.** Arranging a day
  for something wrote back the length as it was when the page loaded.
- **A completion time that cannot be read is refused.** It used to be ignored,
  and the evening filed at whatever time the plan already carried.

#### Changed
- **The schedule sheet builds itself when you open it.** On a large account the
  Things to do page was shipping a copy of the whole contact list inside every
  shared idea's collapsed scheduler, which made the page slow to load and slow
  to respond long before anybody arranged anything.
