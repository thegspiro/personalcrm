import { MapPin } from "lucide-react";
import Link from "next/link";
import { formatDistance, type Distance } from "@/lib/geo";

export interface NearbyPlace {
  id: string;
  name: string;
  city: string | null;
  mapHref: string;
  distance: Distance | null;
}

/**
 * Places you already know about, nearest to somebody first.
 *
 * A server component: there is nothing to interact with, and the rows are read
 * straight out of a query that has already applied the privacy fragments. Shown
 * only when the person has a placed address, so it never appears as an empty
 * card asking to be filled in.
 */
export function NearbyPlaces({
  places,
  heading = "Places near them",
}: {
  places: NearbyPlace[];
  heading?: string;
}) {
  if (places.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">{heading}</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Somewhere you have been before, measured in a straight line.
      </p>
      <ul className="mt-2.5 grid gap-1">
        {places.map((place) => (
          // `min-w-0` on the row and the label both: without it a long venue
          // name refuses to shrink and pushes the distance off the side of a
          // phone, where it looks present and is not.
          <li key={place.id} className="flex min-w-0 items-baseline gap-2">
            <Link
              href={`/locations/${place.id}`}
              className="min-w-0 flex-1 truncate text-sm hover:underline"
            >
              {place.name}
              {place.city ? (
                <span className="text-muted-foreground"> · {place.city}</span>
              ) : null}
            </Link>
            {place.distance ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatDistance(place.distance)}
              </span>
            ) : null}
            <a
              href={place.mapHref}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`Open ${place.name} on a map`}
              className="shrink-0 text-accent-11"
            >
              <MapPin className="size-3.5" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
