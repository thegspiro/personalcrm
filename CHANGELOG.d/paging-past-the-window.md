### Getting past the first two hundred — 2026-09-08

*Schema: none*

#### Added
- **People and the timeline can be paged.** Both drew a fixed window — the
  first 200 people, the most recent 100 entries — and said so, but there was no
  way to reach anything behind it except by narrowing the filters. Both now
  have a pager. The window is the same size as before; what is new is being
  able to leave it.
- **Where you are in a list is part of the address.** Page two of your people,
  filtered and sorted the way you left it, is a link you can bookmark or send.

#### Changed
- **The people list says which page you are on and how many there are** —
  "51–100 of 247" — in place of the notice that only said the list had been cut
  short. The timeline says the page you are on but not how many follow: it
  merges five different kinds of thing and projects recurring dates into
  occurrences, so counting the whole feed would mean building the whole feed,
  and a number that was guessed would be worse than none.
- **Changing a filter takes you back to the first page.** Narrowing a search
  while on page four would otherwise show page four of the new results, which
  is usually empty and looks exactly like having no matches at all.
- **A link to a page that no longer exists opens the last one that does**,
  rather than an empty list — what happens to a bookmark after the people
  behind it are archived.
