### Private contact avatars — 2026-09-02

*Schema: none*

#### Added
- **Upload, replace, and remove a person's avatar.** JPEG, PNG, and WebP files
  up to 2 MB are checked for being whole — a truncated upload is refused rather
  than replacing a good photo — kept in persistent server storage outside
  `public/`, and served only after account ownership and the privacy lock are
  checked, in one query per image.

#### Fixed
- **Avatar cleanup follows contact lifecycle changes.** Replacing or removing
  an avatar and deleting its contact clean up obsolete files without leaving a
  database path pointing at bytes deliberately removed by the operation.
