import Link from "next/link";
import { notFound } from "next/navigation";
import { getUserContext } from "@/server/user/context";
import { getLocationHistory } from "@/server/queries/locations";
import { offlineCacheable } from "@/server/privacy/offline";
import { CacheThisPage } from "@/components/offline/offline";

export const dynamic = "force-dynamic";

export default async function LocationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, timezone } = await getUserContext();
  const [location, cacheable] = await Promise.all([getLocationHistory(user.id, id), offlineCacheable(user.id)]);
  if (!location) notFound();
  const format = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: timezone });
  return <div className="grid gap-5">
    {cacheable ? <CacheThisPage /> : null}
    <div><Link href="/locations" className="text-xs text-muted-foreground hover:underline">← Locations</Link><h2 className="mt-1 text-xl font-semibold">{location.displayName}</h2>{location.address ? <p className="text-sm text-muted-foreground">{location.address}</p> : null}{location.details ? <p className="mt-2 text-sm">{location.details}</p> : null}</div>
    <section><h3 className="mb-2 text-sm font-semibold">People</h3><div className="flex flex-wrap gap-2">{location.contacts.map((contact) => <Link key={contact.id} href={`/people/${contact.id}`} className="rounded-full border bg-card px-3 py-1.5 text-sm hover:bg-muted">{contact.firstName}{contact.lastName ? ` ${contact.lastName}` : ""}</Link>)}</div></section>
    <section><h3 className="mb-2 text-sm font-semibold">Interaction history</h3><div className="grid gap-2">{location.interactions.map((interaction) => <article key={interaction.id} className="rounded-xl border bg-card p-3"><div className="flex justify-between gap-3"><strong className="text-sm">{interaction.title ?? interaction.type?.label ?? "Interaction"}</strong><time className="text-xs text-muted-foreground">{format.format(interaction.occurredAt)}</time></div>{interaction.notes ? <p className="mt-1 text-sm text-muted-foreground">{interaction.notes}</p> : null}<div className="mt-2 flex flex-wrap gap-2">{interaction.participants.map(({ contact }) => <Link key={contact.id} href={`/people/${contact.id}`} className="text-xs text-accent-11 hover:underline">{contact.firstName}{contact.lastName ? ` ${contact.lastName}` : ""}</Link>)}</div></article>)}</div></section>
  </div>;
}
