### One calendar icon, in every browser — 2026-09-13

*Schema: none*

#### Fixed
- **The "When" box no longer shows two calendar icons in Firefox.** The field
  was a native date-and-time input with the app's own calendar button laid over
  the browser's built-in one. Hiding the built-in one works in Chrome, Edge and
  Safari; Firefox does not let a page reach it at all, so Firefox showed two
  icons side by side that opened two different pickers. The field is now drawn
  entirely by the app — the same shape the birthday and life-event dates have
  always used — so there is one calendar, and it is the same one everywhere.

#### Changed
- **The "When" box shows the date in words and opens on a click anywhere on
  it.** It reads "September 11, 2026 at 6:00 PM" rather than 09/11/2026 06:00
  PM, and the whole control opens the calendar instead of one small icon at its
  end. The Now / −1 day / −1 week / −1 month shortcuts are unchanged, and
  nothing about what gets saved has changed.
- **You can type a date into it again, in the words you would actually use.**
  "yesterday", "last Tuesday at 3:30pm" and "3 days ago" all work, which the
  old box did not accept — it only took a typed-out numeric date. Saying a time
  sets the time; not saying one leaves the time alone.
- **On a phone, the "When" box no longer opens the operating system's own date
  wheel.** It opens the same calendar as everywhere else. This is the one thing
  the change costs: the native wheel was good, and it was only available
  because the field was a native input — which is also what put the second icon
  in Firefox.
