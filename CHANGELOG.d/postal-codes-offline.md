### A postal code can fill in the city — 2026-09-11

*Schema: `20260911193014_add_postal_codes`*

#### Added
- **Import a country's postal codes and an address fills in its own city and
  state.** Type the code, press the button beside it, and the city and region
  appear. Nothing is sent anywhere to do it: the data is already on the machine,
  so this works with no network, with the address lookup switched off, and for a
  contact you have marked private — none of which is true of the geocoder.
- **You supply the file, and that is deliberate.** Settings → Places takes a
  country file downloaded from GeoNames. There is no download built in, so an
  installation that never reaches the internet is not a second-class one. One
  country at a time; a re-import replaces that country rather than piling a
  second copy on it, and each can be removed on its own.
- **A code that covers several places offers them rather than choosing.** A
  postal code really can name more than one town, and which one an address means
  is not something the app can know. It fills the city in only when exactly one
  place answers.

An installation that imports nothing sees no change at all: the control is not
there, and every address field behaves exactly as it did.

Postal code data is published by [GeoNames](https://www.geonames.org/) under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
