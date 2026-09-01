### Promises the app was not keeping — 2026-09-01

*Schema: none*

#### Fixed
- **Favouriting someone now pins them near the top of your lists**, which the
  checkbox has always said it does. No sort ordered by it, so the star was
  decoration. There is also a **Favourites** filter chip, which the query has
  supported all along with nothing to reach it. The overdue sort deliberately
  stays untouched: that list means "who is most overdue", and floating anyone
  above that answers a different question.
- **"Log an interaction" in the command palette opens the sheet.** It navigates
  to `/?log=1`, and nothing read that parameter, so it landed on the dashboard
  and stopped there.
- **Custom fields for Dating profiles and Dates now appear.** Settings offered
  both groups and described where they would show up; neither form ever
  rendered them, so nothing could be saved into them and the value count stayed
  at zero however many fields you defined.
- **How long an interaction lasted is shown on the timeline.** The field was
  collected when logging, saved, and displayed nowhere.
- **"The place", "Region" and "Country" have inputs.** All three were read from
  the contact form by the save actions and had no fields to read, so they were
  written as empty on every save.
