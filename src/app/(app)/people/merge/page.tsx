import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getUserContext } from "@/server/user/context";
import { getMergePair } from "@/server/queries/duplicates";
import { getPrivacyState } from "@/server/privacy/lock";
import { MergeForm } from "@/components/contacts/merge-form";

export const metadata: Metadata = { title: "Merge people" };
export const dynamic = "force-dynamic";

export default async function MergePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { user } = await getUserContext();
  const { a, b } = await searchParams;
  if (!a || !b) notFound();

  // Merging can move private rows and can make a public record private, so it
  // is not something to do on behalf of somebody who cannot see what they are
  // merging. The action re-checks; this is so the screen never even offers it.
  const privacy = await getPrivacyState();
  if (privacy.enabled && !privacy.unlocked) redirect("/unlock?next=/people");

  const pair = await getMergePair(user.id, a, b);
  if (!pair) notFound();

  return <MergeForm a={pair.a} b={pair.b} />;
}
