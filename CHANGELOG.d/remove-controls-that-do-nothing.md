### Controls that did nothing — 2026-09-01

*Schema: none*

#### Removed
- **The "Profile" item in the account menu.** It linked to `/settings/profile`,
  which has never existed, so the only thing it did was render the 404 page.
  There is no account management yet — that is now listed under known gaps
  rather than implied by a menu item.
- **The "Weeks start on" choice**, in Settings and in the welcome wizard. It
  saved to the account and nothing anywhere read it: there is no calendar grid
  in the app, so picking Monday changed nothing on any screen. The column stays,
  marked reserved, so no migration is needed if a calendar ever arrives.
- **`currentUserAction`**, an exported server action with no callers. Every
  server action is a public POST endpoint, so an unused one is surface for
  nothing.
- **The unreachable tag write path.** `applyTags` created tags and attached
  them, but it was gated on a form field no component has ever emitted, and
  `listTags` had no callers. Contact list and detail queries were also joining
  and selecting tags that nothing rendered, on every page load.
- **`papaparse`**, a dependency with no imports.
