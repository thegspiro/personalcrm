### Your data, in formats other things can read — 2026-09-02

*Schema: none*

#### Added
- **Export, under Settings → Data.** Four formats, because they answer
  different questions. JSON is the account's data — people, history, dates,
  plans, and the field and type definitions you made yourself — and is the one
  to keep if you keep only one. It holds no images: avatars are files under
  `uploads/`, and as [backup](../docs/backup.md) has always said, that
  directory and the database have to be kept and restored together. CSV is the
  contacts flattened to a row each,
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
  something that looks complete and is not. Unlock first, whatever is in the
  account — the lock covers the dating side as well as anything you marked
  private, and deciding by counting private rows would both miss that and
  answer the question of whether you have any.

  The JSON file carries your display name and email so a restore can put the
  account back. It does not carry your password, your privacy PIN, or your
  signed-in sessions; a backup that could hand over the account is not a
  backup you can leave anywhere.

  Nothing is sent anywhere. The file is built on the machine and handed to your
  browser to save.
