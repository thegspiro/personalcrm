### Family page: linking, renaming, and an honest tree — 2026-09-03

*Schema: none*

#### Added
- **Link two relatives from the Family page.** Until now the page that shows
  you the gap in a family could not fill it: recording a link meant knowing
  which of the two people to open in People first. Both ends are picked on the
  page, in the order the sentence reads, and the write goes through the same
  action the contact page uses — so the reverse link is still recorded at the
  same time.
- **Rename a household, or change its notes.** Households could be created and
  deleted but never corrected, so a typo in "The Whitfields" meant deleting the
  group and rebuilding its membership. Renaming leaves everyone in place.
- **Photos on the Family page.** The tree and the household chips show the same
  avatars as People and the dashboard, rather than initials only.

- **The tree separates close family from everyone else.** A generation band is
  not a relationship, so banding alone set cousins, in-laws and stepsiblings
  beside your own sister. Each band is now split into Immediate family,
  Extended family, In-laws, Step & half, Chosen and Former — the same headings
  the contact page uses. Relatives the tree can only reach through someone else
  are grouped under that person ("Through Mum") rather than being guessed into
  a tier beside relationships you actually recorded, and anyone with no path at
  all is named as such. Bands that hold nothing but immediate family stay as
  plain as before.

#### Fixed
- **The "generations measured from" picker no longer names the wrong person.**
  It matched the selected option by display name, so with two relatives sharing
  one — two cousins called Sam, or anyone recorded twice under a nickname — it
  claimed the tree was rooted on someone it was not. It now matches on identity,
  and follows the browser's back and forward buttons.
- **A truncated Family page says so.** The contact pickers stop at 500 people
  and the suggestion list at 24; both now say when there is more behind them,
  instead of looking complete. Suggestions are also sorted, so the ones the cap
  admits stay the same between visits rather than reshuffling.
- **Suggestion and link forms no longer share HTML ids.** With more than one
  card open, each "is their…" label pointed at the first select on the page
  rather than its own, so tapping a label could focus the wrong card's control.
- **Less private data reaches the browser.** Household members were serialised
  into the page payload carrying `isPrivate`, `lastInteractionAt` and
  `nextTouchAt`, none of which the page draws — and which offline caching could
  then write to disk.
