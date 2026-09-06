### Your data, in formats other things can read — 2026-09-02

*Schema: none*

#### Added
- **Export, under Settings → Data.** Four formats, because they answer
  different questions. JSON is the whole account — people, history, dates,
  plans, and the field and type definitions you made yourself — and is the one
  to keep if you keep only one. CSV is the contacts flattened to a row each,
  convenient to look at and unable to hold your history, so it is not a backup.
  vCard is for a phone or address book. ICS puts birthdays and important dates
  into any calendar as recurring all-day events, which is the first time
  anything in this app has been able to reach the calendar you actually use.

  Dates keep the accuracy they were recorded at. A birthday with no known year
  leaves as a birthday with no known year rather than acquiring one, in both
  vCard and the spreadsheet, and a date too vague to place on a calendar is
  left out of the ICS file instead of being assigned a day nobody chose.

  **A closed privacy lock declines the export rather than quietly shrinking
  it.** Every other read here hides private rows, which is right for a page;
  for a file that gets carried somewhere else it would mean handing you
  something that looks complete and is not. With nothing private in the
  account, a closed lock is no obstacle — what comes out is already everything.

  Nothing is sent anywhere. The file is built on the machine and handed to your
  browser to save.
