import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ExternalLink, MapPin, Users } from "lucide-react";
import { getUserContext } from "@/server/user/context";
import { getLocation } from "@/server/queries/locations";

export const metadata: Metadata = { title: "Place" };
export const dynamic = "force-dynamic";

export default async function LocationPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, timezone } = await getUserContext();
  const { id } = await params;
  const location = await getLocation(user.id, id);
  if (!location) notFound();
  const people = new Map<string, { id: string; name: string; visits: number; last: Date }>();
  for (const visit of location.interactions) for (const { contact } of visit.participants) {
    const current = people.get(contact.id);
    people.set(contact.id, { id: contact.id, name: [contact.firstName, contact.lastName].filter(Boolean).join(" "), visits: (current?.visits ?? 0) + 1, last: current?.last && current.last > visit.occurredAt ? current.last : visit.occurredAt });
  }
  const mapQuery = location.latitude && location.longitude ? `${location.latitude},${location.longitude}` : location.address ?? location.name;
  const date = (value: Date) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: timezone }).format(value);
  return <div className="grid gap-5">
    <div><Link href="/locations" className="text-xs text-accent-11 hover:underline">← All places</Link><div className="mt-2 flex items-start gap-3"><MapPin className="mt-1 size-5 text-accent-11" /><div><h2 className="text-xl font-semibold">{location.name}</h2>{location.address ? <p className="text-sm text-muted-foreground">{location.address}</p> : null}<a className="mt-1 inline-flex items-center gap-1 text-xs text-accent-11 hover:underline" href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(mapQuery)}`} target="_blank" rel="noreferrer">Open map <ExternalLink className="size-3" /></a></div></div></div>
    <section><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Users className="size-4" />People seen here</h3><div className="grid gap-2 sm:grid-cols-2">{[...people.values()].sort((a,b) => b.visits-a.visits).map((person) => <Link key={person.id} href={`/people/${person.id}`} className="rounded-lg border bg-card p-3"><p className="text-sm font-medium">{person.name}</p><p className="text-xs text-muted-foreground">{person.visits} visit{person.visits === 1 ? "" : "s"} · last {date(person.last)}</p></Link>)}</div>{!people.size ? <p className="text-sm text-muted-foreground">Nobody has been recorded here yet.</p> : null}</section>
    <section><h3 className="mb-2 text-sm font-semibold">Visit history</h3><div className="grid gap-2">{location.interactions.map((visit) => <div key={visit.id} className="rounded-lg border bg-card p-3"><div className="flex justify-between gap-2"><p className="text-sm font-medium">{visit.title ?? visit.type?.label ?? "Interaction"}</p><time className="text-xs text-muted-foreground">{date(visit.occurredAt)}</time></div><p className="mt-1 text-xs text-muted-foreground">{visit.participants.map(({ contact }) => [contact.firstName, contact.lastName].filter(Boolean).join(" ")).join(", ")}</p>{visit.notes ? <p className="mt-2 text-sm">{visit.notes}</p> : null}</div>)}</div></section>
    {location.plans.length ? <section><h3 className="mb-2 text-sm font-semibold">Plans</h3><div className="grid gap-2">{location.plans.map((plan) => <div key={plan.id} className="rounded-lg border bg-card p-3"><p className="text-sm font-medium">{plan.title}</p><p className="text-xs text-muted-foreground">{plan.status.toLowerCase()}{plan.contact ? ` · with ${plan.contact.firstName}` : ""}</p></div>)}</div></section> : null}
  </div>;
}
