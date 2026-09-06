### Bring your contacts in — 2026-09-06

*Schema: none*

#### Added
- **Import, under Settings → Data.** A `.vcf` from a phone or address book, or
  a `.csv` from a spreadsheet. Until now the first hour with this app was
  typing several hundred people in by hand, which is a reason not to start.

  **Nothing is written until you have seen what would happen.** The file is
  read and described first: who is in it, which entries look like somebody
  already here, and which cannot be read at all. Anything that looks like a
  repeat starts unticked, so the cautious answer is the one that takes no
  attention. Merging two people who turn out to be different is the one thing
  an import cannot take back, so it is never done automatically — a duplicate
  is visible and fixable, a bad merge has already lost whichever value it did
  not keep.

  Birthdays keep the accuracy the file stated. A vCard birthday written
  without a year arrives as a birthday without a year rather than acquiring
  one, which is the same care the export takes on the way out.

  Files from older exporters are read rather than refused. A `.vcf` written
  by a phone from the 2.1 era stores anything non-ASCII as escape codes and
  writes a mobile as `TEL;CELL;VOICE`; a name arrives as José rather than
  `Jos=C3=A9`, and that number is filed as a mobile rather than a landline. A
  number written `tel:+1555…` loses the prefix, and a post-office box survives
  on the second address line instead of being dropped. A birthday of the
  thirty-first of April is left off entirely, because moving it to the
  thirtieth would put a date in your account that the file never gave.

  Imported contacts are never marked private, whatever the file says. Nothing
  arriving from outside has any standing to decide what is hidden inside your
  account.

  Restoring a whole account from the JSON export is **not** part of this.
  Merging a complete account into one that already has contacts in it is a
  different and much harder problem than adding people to a list, and doing it
  badly would be worse than not offering it.
