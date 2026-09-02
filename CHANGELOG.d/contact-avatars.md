### Private contact avatars — 2026-09-02

*Schema: none*

#### Added
- **Upload, replace, and remove a person's avatar.** JPEG, PNG, and WebP files
  up to 2 MB are signature-checked, kept in persistent server storage, and
  served only after account ownership and the privacy lock are checked.

#### Fixed
- **Avatar cleanup follows contact lifecycle changes.** Replacing or removing
  an avatar and deleting its contact clean up obsolete files without leaving a
  database path pointing at bytes deliberately removed by the operation.
