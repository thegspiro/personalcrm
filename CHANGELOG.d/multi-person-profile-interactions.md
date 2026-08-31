### Log group interactions from a profile — 2026-08-31

*Schema: none*

#### Fixed
- **Logging from a person's profile now keeps the people picker available.**
  The profile person starts selected, while more participants can be searched
  for and added to one shared interaction that appears on every profile.
- **Repeated participant IDs are normalized on the server.** Every person is
  still checked against the signed-in account, and activity is recomputed once
  for every affected profile.
