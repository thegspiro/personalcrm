### Suggest an address as you type — 2026-09-08

*Schema: none*

#### Added
- **Address fields can now suggest as you type, if you ask them to.** Settings →
  Places gains a second switch beside the address lookup's own, and it is off
  until you turn it on. With it on, typing into an address — a person's, a
  place's, or your own home base — offers matches after a pause, and picking one
  fills in the street, city, region, country and coordinates just as pressing the
  button always did. Nothing is written until you save.
- **The switch only appears where the endpoint allows it.** The OpenStreetMap
  Foundation's own service asks applications not to search as you type, so with
  that provider selected the switch is not offered and the button is the only
  route — including if you point a self-hosted entry back at it. Photon is built
  for typing and is the one public option that offers it.
- **A documented way to run Photon yourself**, in
  [configuration.md](docs/configuration.md), for suggestions where no address
  leaves your network. It is a separate container and stays entirely optional;
  the published image is unchanged and nothing new is bundled.

#### Changed
- **Turning the address lookup on still means what it meant.** Suggesting while
  you type is a second, separate decision rather than a faster version of the
  first, and an installation that switched the lookup on before this release
  behaves exactly as it did. Sending an address when you ask for one is not the
  same as sending a dozen drafts of every address you touch.
- **Accepting a match now fills the street line.** It used to leave the address
  lines exactly as typed and fill only the city, region and coordinates, so a
  half-typed street stayed half-typed. Where a match carries no street of its
  own, what you typed is kept rather than replaced — an OpenStreetMap display
  name runs from the house number to the country and is not an address line.
- **Requests to an endpoint you do not run are now spaced out**, not just the
  ones to the OpenStreetMap Foundation's. A shared public instance sees a small
  gap between requests where it previously saw none; your own endpoint is
  unaffected.

#### Fixed
- **An address is never sent just because you opened a form to read it.** The
  query a lookup sends is assembled from the address lines, city, region and
  country together, so an address that was already filled in would have gone out
  the moment its form appeared. Nothing is sent on a page load, and a private
  contact's address is still never sent at all, whatever is switched on.
