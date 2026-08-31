import Link from "next/link";
import type { Metadata } from "next";
import { MapPin, Users, CalendarDays, Lightbulb } from "lucide-react";
import { CacheThisPage } from "@/components/offline/offline";
import { Input } from "@/components/ui/input";
import { getUserContext } from "@/server/user/context";
import { offlineCacheable } from "@/server/privacy/offline";
import { listLocations } from "@/server/queries/locations";

export const metadata: Metadata = { title: "Places" };
export const dynamic = "force-dynamic";

export default async function LocationsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { user, timezone } = await getUserContext();
  const { q } = await searchParams;
  const [locations, cacheable] = await Promise.all([listLocations(user.id, q), offlineCacheable(user.id)]);
  const mostVisited = [...locations].sort((a, b) => b.visitCount - a.visitCount)[0];
  const neverVisited = locations.filter((location) => location.visitCount === 0 && location.openPlanCount > 0).length;

  return <div className="grid gap-4">
    {cacheable ? <CacheThisPage /> : null}
    <div><h2 className="text-lg font-semibold tracking-tight">Places</h2><p className="text-xs text-muted-foreground">Where you have been, who went with you, and what is still planned.</p></div>
    <form className="max-w-md"><Input name="q" defaultValue={q} placeholder="Find a place or address" aria-label="Find a place" /></form>
    {locations.length ? <div className="grid gap-2 sm:grid-cols-3">
      <Summary icon={<MapPin className="size-4" />} label="Places" value={String(locations.length)} />
      <Summary icon={<CalendarDays className="size-4" />} label="Most visited" value={mostVisited ? `${mostVisited.name} · ${mostVisited.visitCount}` : "—"} />
      <Summary icon={<Lightbulb className="size-4" />} label="Planned, not visited" value={String(neverVisited)} />
    </div> : null}
    <div className="grid gap-3 sm:grid-cols-2">
      {locations.map((location) => <Link key={location.id} href={`/locations/${location.id}`} className="rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/50">
        <div className="flex items-start justify-between gap-3"><div><h3 className="font-medium">{location.name}</h3>{location.address ? <p className="mt-0.5 text-xs text-muted-foreground">{location.address}</p> : null}</div><MapPin className="size-4 shrink-0 text-accent-11" /></div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{location.visitCount} visit{location.visitCount === 1 ? "" : "s"}</span><span><Users className="mr-1 inline size-3" />{location.peopleCount} people</span>{location.openPlanCount ? <span>{location.openPlanCount} open plan{location.openPlanCount === 1 ? "" : "s"}</span> : null}</div>
        {location.lastVisitedAt ? <p className="mt-2 text-xs text-muted-foreground">Last visited {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: timezone }).format(location.lastVisitedAt)}</p> : null}
      </Link>)}
    </div>
    {!locations.length ? <div className="rounded-xl border border-dashed p-8 text-center"><MapPin className="mx-auto mb-2 size-6 text-muted-foreground" /><p className="text-sm font-medium">No places yet</p><p className="text-xs text-muted-foreground">Add a venue to an interaction or plan and it will appear here.</p></div> : null}
  </div>;
}

function Summary({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded-xl border bg-card p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>;
}
