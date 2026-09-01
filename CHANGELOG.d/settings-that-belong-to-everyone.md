### Settings that belong to everyone — 2026-09-01

*Schema: none*

#### Fixed
- **Only an administrator can change the assisted-reading provider.** It is
  stored per installation rather than per account, so on an install with more
  than one person any member could point it at a server they control and
  collect the lines every other account typed into quick add — and the same
  actions hold an API key. The address lookup already had this guard; this is
  the same hole in the older feature beside it. The panel now says so instead
  of offering a control that would fail.
- **`src/server/ai/` is no longer described as deletable.** Quick add genuinely
  does not need it — it is off by default and nothing in it runs while it is
  off — but the settings page imports its provider table statically, so
  deleting the directory is a build change. The claim appeared in three places
  and is now what the code actually guarantees.
