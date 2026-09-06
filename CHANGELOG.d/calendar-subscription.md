### Your calendar, in your calendar — 2026-09-06

*Schema: `20260906120000_add_calendar_feed`*

#### Added
- **Subscribe to your dates from any calendar app.** Settings → Data now offers
  a private web address you can add to Google Calendar, Apple Calendar, Outlook
  or a phone. Birthdays and important dates, things you have planned,
  follow-ups with a due date, and what people have on all appear alongside the
  rest of your day, and refresh on your calendar app's own schedule. A plan with
  a time appears at that time, for as long as you set aside; one with no length
  recorded appears at its start rather than being padded to a made-up hour, and
  a trip appears as one entry spanning its days rather than one per day.
- **Anything hidden stays hidden.** Whoever fetches the address is not signed in
  and cannot unlock, so the feed is built exactly as though the privacy lock
  were closed: nobody you have marked private, nothing you have marked private,
  and nothing from your date log is ever in it. For an account that uses the
  privacy marker this means the subscription is deliberately incomplete — it
  shows what a locked screen shows. Note that plans and follow-ups are included
  even when they name someone you are seeing, exactly as they appear on the
  calendar in the app; marking that person private is what keeps them out.
- **The address is revocable.** Treat it like a password: anyone holding it can
  read the rest. Creating a new address stops the old one working everywhere it
  is subscribed, which is how you revoke one shared by mistake, and turning the
  subscription off stops it entirely. It is stored hashed, plus a copy encrypted
  with the server's own key so it can be shown to you again — a database backup
  on its own does not hand over working addresses. Changing your password does
  not revoke it, deliberately: it never grants access to the app, and quietly
  breaking your calendars would not read as a security measure.
