import type { LocalitySuggestions } from "@/server/queries/locations";

/**
 * The ids the locality boxes point their `list=` at.
 *
 * Exported as constants rather than written out at each site because the
 * coupling is by string: an input whose `list` names a datalist that is not in
 * the document simply offers nothing, silently and with no type error.
 */
export const LOCALITY_LIST_IDS = {
  city: "locality-cities",
  region: "locality-regions",
  country: "locality-countries",
} as const;

/**
 * One set of suggestions for every locality box in the app.
 *
 * Rendered once, in the app shell, rather than beside each field. A `<datalist>`
 * is resolved by id from anywhere in the document, the suggestions are the same
 * whichever form is asking, and the alternative — the same three lists rendered
 * by five components across as many pages — would put duplicate ids in the
 * document the moment two of those forms appeared together.
 *
 * Nothing is rendered when there is nothing to offer, so a new account does not
 * get an empty dropdown arrow on every address field.
 */
export function LocalityOptions({ localities }: { localities: LocalitySuggestions }) {
  return (
    <>
      <Options id={LOCALITY_LIST_IDS.city} values={localities.cities} />
      <Options id={LOCALITY_LIST_IDS.region} values={localities.regions} />
      <Options id={LOCALITY_LIST_IDS.country} values={localities.countries} />
    </>
  );
}

function Options({ id, values }: { id: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <datalist id={id}>
      {values.map((value) => (
        <option key={value} value={value} />
      ))}
    </datalist>
  );
}
