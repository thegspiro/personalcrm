### Phone numbers, emails and addresses — 2026-09-01

*Schema: none*

#### Added
- **Somewhere to put a phone number.** Contact pages have a "How to reach
  them" section for numbers, email addresses and handles, and a "Where they
  are" section for postal addresses. Both tables have existed since the first
  migration and were loaded on every contact page; nothing could write to them,
  so a personal CRM had no way to store the one thing you look someone up for.
- **The primary method appears under the person's name**, so it is one tap
  rather than a scroll past six sections. Numbers become `tel:` links,
  addresses `mailto:`, and handles resolve to a profile where the service is
  one the app ships a type for.
- **Search now finds people by their number or address**, which the query
  already allowed for and no data could satisfy.

#### Changed
- **The "Contact methods" list under Settings → Types now counts something.**
  It has always offered rename, recolour, reorder and delete for terms
  classifying rows that could not exist, so its usage count was permanently
  zero.
- Addresses are returned in a defined order. They were fetched with no
  `orderBy`, so the rows reshuffled between renders.

#### Notes
- Values are stored exactly as typed. Nothing reformats a number to E.164,
  because that has to guess a country nobody supplied. The consequence is that
  search matches the stored string — someone filed as `+1 (555) 010-4477` is
  not found by typing `5550104477`.
- A contact page cached for offline reading now carries these details too.
  Neither table has an `isPrivate` marker of its own: both inherit the
  contact's, so a private person's number is withheld exactly when they are.
