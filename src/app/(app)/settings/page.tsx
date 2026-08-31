import type { Metadata } from "next";
import { getUserContext } from "@/server/user/context";
import { prisma } from "@/server/db/client";
import { normalizeDashboardLayout } from "@/lib/dashboard";
import { listTerms } from "@/server/taxonomy/queries";
import { listTaxonomyAdmin } from "@/server/queries/taxonomy-admin";
import { listAllFieldDefinitions } from "@/server/queries/custom-fields";
import { TAXONOMY_KIND_LABELS } from "@/server/taxonomy/defaults";
import { PrivacySettings } from "@/components/dating/privacy-settings";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { AppSettings } from "@/components/settings/app-settings";
import { CustomFieldsSettings } from "@/components/settings/custom-fields-settings";
import { DashboardSettings } from "@/components/settings/dashboard-settings";
import { TaxonomySettings } from "@/components/settings/taxonomy-settings";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { AiSettings } from "@/components/settings/ai-settings";
import { getAiStatus } from "@/server/ai/config";
import { getPrivacyState } from "@/server/privacy/lock";
import { PROVIDERS } from "@/server/ai/providers";
import { GeoSettings } from "@/components/settings/geo-settings";
import { getGeoStatus } from "@/server/geo/config";
import { GEO_PROVIDERS } from "@/server/geo/providers";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user, prefs } = await getUserContext();

  const [taxonomies, definitions, categories, layoutRow, valueCounts, ai, geo, privacyState] = await Promise.all([
    listTaxonomyAdmin(user.id),
    listAllFieldDefinitions(user.id),
    listTerms(user.id, "CONTACT_CATEGORY"),
    prisma.dashboardLayout.findUnique({ where: { userId: user.id } }),
    prisma.customFieldValue.groupBy({
      by: ["definitionId"],
      where: { ownerId: user.id },
      _count: { _all: true },
    }),
    getAiStatus(),
    getGeoStatus(),
    getPrivacyState(),
  ]);

  // Value counts drive the delete warning: deleting a field takes everything
  // recorded in it with it, so the confirmation has to say how much.
  const counts = new Map(valueCounts.map((row) => [row.definitionId, row._count._all]));
  const withCount = (rows: typeof definitions.CONTACT) =>
    rows.map((row) => ({ ...row, valueCount: counts.get(row.id) ?? 0 }));
  const withCounts = {
    CONTACT: withCount(definitions.CONTACT),
    ROMANTIC: withCount(definitions.ROMANTIC),
    INTERACTION: withCount(definitions.INTERACTION),
    DATE_ENTRY: withCount(definitions.DATE_ENTRY),
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
        <p className="text-xs text-muted-foreground">Make the app work the way you do.</p>
      </div>

      <SettingsTabs
        appearance={
          <AppearanceSettings
            accent={prefs.accent}
            density={prefs.density}
            defaultCadenceDays={prefs.defaultCadenceDays}
            weekStartsOn={prefs.weekStartsOn}
            timezone={prefs.timezone}
          />
        }
        fields={
          <CustomFieldsSettings
            definitions={withCounts}
            categories={categories.map((term) => ({
              id: term.id,
              label: term.label,
              icon: term.icon,
              color: term.color,
            }))}
          />
        }
        taxonomies={
          <TaxonomySettings
            groups={taxonomies.map((group) => ({
              kind: group.kind,
              title: TAXONOMY_KIND_LABELS[group.kind].title,
              description: TAXONOMY_KIND_LABELS[group.kind].description,
              terms: group.terms.map((term) => ({
                id: term.id,
                slug: term.slug,
                label: term.label,
                icon: term.icon,
                color: term.color,
                isSystem: term.isSystem,
                isActive: term.isActive,
                usageCount: term.usageCount,
                inverseTermId: term.inverseTermId,
                inverseLabel: term.inverseLabel,
              })),
            }))}
          />
        }
        dashboard={<DashboardSettings layout={normalizeDashboardLayout(layoutRow?.widgets)} />}
        quickadd={
          <AiSettings
            enabled={ai.enabled}
            usable={ai.usable}
            provider={ai.provider}
            baseUrl={ai.baseUrl}
            model={ai.model}
            hasKey={ai.hasKey}
            keySource={ai.keySource}
            keyHint={ai.keyHint}
            providers={PROVIDERS}
          />
        }
        places={
          <GeoSettings
            enabled={geo.enabled}
            usable={geo.usable}
            provider={geo.provider}
            baseUrl={geo.baseUrl}
            providers={GEO_PROVIDERS}
          />
        }
        privacy={
          <PrivacySettings
            pinSet={Boolean(user.privacyPinHash)}
            privacyLockEnabled={prefs.privacyLockEnabled}
            hideDating={prefs.hideDating}
            blurPrivateNotes={prefs.blurPrivateNotes}
            retryAfterSeconds={privacyState.retryAfterSeconds}
          />
        }
        app={<AppSettings installedAt={prefs.pwaInstalledAt?.toISOString() ?? null} />}
      />
    </div>
  );
}
