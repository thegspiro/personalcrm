### The delivery budget, and tags another account touched — 2026-09-03

*Schema: none*

#### Fixed
- **Looking up whether the owner is an administrator counts against the
  delivery deadline.** It was the last step still outside the budget, so a
  stalled query held the send open past the row's lease — long enough for a
  later pass to reclaim it and send the same reminder again. Nothing between
  the start of a delivery and its return is outside the clock now.
- **A tag is still "on nobody" when the only person using it belongs to
  another account.** The join and the contact are separate foreign keys, so an
  imported row can leave one there; counting it made an otherwise unassigned
  tag disappear while the privacy lock was closed, and unusable everywhere with
  it, on the strength of someone its owner cannot see.
