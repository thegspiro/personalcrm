### Distinct allergy categories — 2026-08-31

*Schema: `20260831120000_add_allergy_category`*

#### Added
- **Food, medication, and environmental allergies are now clearly distinct.**
  Existing dietary records remain intact and food-related, while dietary
  restrictions and preferences keep their own labels and grouping.

#### Fixed
- Epinephrine is shown and stored only for allergies; changing an entry to a
  preference or dietary restriction clears the old flag.
