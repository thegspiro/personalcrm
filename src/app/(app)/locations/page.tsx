import Link from "next/link";
import type { Metadata } from "next";
import { MapPin } from "lucide-react";
import { getUserContext } from "@/server/user/context";
import { listLocations } from "@/server/queries/locations";
import { offlineCacheable } from "@/server/privacy/offline";
import { CacheThisPage } from "@/components/offline/offline";

export const metadata: Metadata = { title: "Locations" };
export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  const { user } = await getUserContext();
  const [locations, cacheable] = await Promise.all([listLocations(user.id), offlineCacheable(user.id)]);
  return <div className="grid gap-4">
    {cacheable ? <CacheThisPage /> : null}
    <div><h2 className="text-lg font-semibold">Locations</h2><p className="text-xs text-muted-foreground">Places from your recorded interactions.</p></div>
    <div className="grid gap-2">
      {locations.map((location) => <Link key={location.id} href={`/locations/${location.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-muted/60">
        <MapPin className="size-4 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block font-medium">{location.displayName}</span>{location.address ? <span className="block text-xs text-muted-foreground">{location.address}</span> : null}</span>
        <span className="text-right text-xs text-muted-foreground">{location.visitCount} {location.visitCount === 1 ? "visit" : "visits"}<br />{location.participantCount} {location.participantCount === 1 ? "person" : "people"}</span>
      </Link>)}
      {!locations.length ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Locations appear when you add a place to an interaction.</p> : null}
    </div>
  </div>;
}
