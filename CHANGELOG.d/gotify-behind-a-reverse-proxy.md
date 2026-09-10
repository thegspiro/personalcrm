### A Gotify server behind a reverse proxy now receives its reminders — 2026-09-10

*Schema: none*

#### Fixed
- **A Gotify channel saved with a subpath address delivers.** Where a reverse
  proxy publishes Gotify at `https://home.example.com/gotify`, that is the
  whole of what its web UI shows in the browser's bar and it is what gets
  pasted — but the message endpoint is one segment further down, so every
  reminder failed with a 404 and nothing to act on. The address is now posted
  to exactly as typed, and only if *that* answers 404 is `/message` beneath it
  tried, once. An alias that already maps straight onto Gotify's message
  endpoint is therefore unchanged, and a 404 posts nothing, so the second
  attempt cannot deliver a message twice.
- **An address ending in `/message/` delivers too.** Gotify's router answers
  the trailing slash with a redirect, which is deliberately not followed — the
  same paste failing as a 307 rather than a 404. Trailing slashes are dropped
  before the request is made.
- **A Gotify 404 says what was looked for.** "Channel returned HTTP 404" gave
  no clue that the address, not the token or the server, was the problem; it
  now names the endpoint that went unanswered. And when the endpoint beneath a
  404 answers with something real — a rejected token, say — that is reported
  instead, rather than the 404 from the address it was typed at.

#### Changed
- The Gotify **URL** field now suggests the server's own address and says the
  message endpoint is found from it. Existing channels are untouched: an
  address already pointing at `/message` is posted to exactly as before.
