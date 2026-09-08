### Text you can actually read — 2026-09-06

*Schema: none*

#### Fixed
- **Faint text throughout the app now meets the contrast standard.** Field
  hints, the placeholder in a date picker, and the coloured labels on types and
  tags were all drawn at a fraction of an already-grey colour, which put them
  under the threshold for readable text — hardest on exactly the people who need
  it most. They are now drawn at full strength, and the coloured labels use a
  darker shade of their own colour.
- **Days from the neighbouring month on the calendar are readable.** They were
  drawn on a see-through tint that blended with the grid lines behind it, which
  made the date fainter than any colour setting suggested. Those cells are now a
  solid shade — just as clearly not part of the month you are looking at.

#### Added
- **Accessibility is now checked automatically.** Every main route, the sign-in
  page, the person form and the two-factor screens are run through axe against
  WCAG 2.1 AA on each change. Serious and critical findings stop the build;
  lesser ones are reported so they can be judged rather than quietly ignored.
