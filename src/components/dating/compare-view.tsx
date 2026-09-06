"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Columns2 } from "lucide-react";
import { cn, displayName } from "@/lib/utils";
import { formatStoredKm, type Unit } from "@/lib/geo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/nav/icon";
import { RatingDisplay } from "@/components/form/rating-input";
import { formatMoney } from "@/lib/format";

export interface CompareItem {
  id: string;
  firstName: string;
  lastName: string | null;
  stageLabel: string | null;
  dateCount: number;
  avgRating: number | null;
  avgChemistry: number | null;
  overallRating: number | null;
  chemistryScore: number | null;
  totalSpentCents: number;
  greenFlags: number;
  redFlags: number;
  dealbreakers: number;
  lastInteractionAt: Date | null;
  exclusive: boolean;
  wantsKids: string;
  distanceKm: number | null;
  relationshipStyle: string | null;
  livingSituation: string | null;
  religion: string | null;
  politics: string | null;
  mbti: string | null;
  heightCm: number | null;
  birthYear: number | null;
  sourceLabel: string | null;
}

type SortKey =
  | "name"
  | "dateCount"
  | "avgRating"
  | "avgChemistry"
  | "overallRating"
  | "totalSpentCents"
  | "lastInteractionAt";

const COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: "name", label: "Person" },
  { key: "dateCount", label: "Dates", numeric: true },
  { key: "overallRating", label: "Overall", numeric: true },
  { key: "avgRating", label: "Avg date", numeric: true },
  { key: "avgChemistry", label: "Chemistry", numeric: true },
  { key: "totalSpentCents", label: "Spent", numeric: true },
  { key: "lastInteractionAt", label: "Last contact", numeric: true },
];

const KIDS_LABELS: Record<string, string> = {
  UNKNOWN: "Not discussed",
  WANTS: "Wants kids",
  DOES_NOT_WANT: "Doesn't want kids",
  OPEN: "Open either way",
  HAS_AND_DONE: "Has kids, done",
};

/** Up to this many people can be held side by side before it stops being readable. */
const MAX_SELECTED = 3;

export function CompareView({
  rows,
  now,
  unit,
}: {
  rows: CompareItem[];
  now: Date;
  /** `distanceKm` is stored in km whatever the account reads distances in. */
  unit: Unit;
}) {
  const [sortKey, setSortKey] = React.useState<SortKey>("overallRating");
  const [ascending, setAscending] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);

  const sorted = React.useMemo(() => {
    const value = (row: CompareItem): number | string => {
      switch (sortKey) {
        case "name":
          return displayName(row).toLowerCase();
        case "lastInteractionAt":
          return row.lastInteractionAt?.getTime() ?? 0;
        default:
          return (row[sortKey] as number | null) ?? -1;
      }
    };
    return [...rows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const delta = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return ascending ? delta : -delta;
    });
  }, [rows, sortKey, ascending]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setAscending((v) => !v);
      return;
    }
    setSortKey(key);
    setAscending(key === "name");
  }

  function toggleSelected(id: string) {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id);
      if (current.length >= MAX_SELECTED) return current;
      return [...current, id];
    });
  }

  const chosen = sorted.filter((row) => selected.includes(row.id));

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="Columns2" />}
        title="Nobody to compare"
        description="Add a couple of people to the dating pipeline first."
      />
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {/* Wide tables scroll inside their own container so the page never does. */}
      <div className="scroll-x rounded-xl border border-border">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="w-10 px-3 py-2" />
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className={cn("px-3 py-2 font-medium", column.numeric && "text-right")}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(column.key)}
                    className={cn(
                      "inline-flex items-center gap-1 text-xs uppercase tracking-wider transition-colors",
                      sortKey === column.key ? "text-accent-11" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {column.label}
                    {sortKey === column.key ? (
                      ascending ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
                    ) : null}
                  </button>
                </th>
              ))}
              <th className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Flags
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.id} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2">
                  <Checkbox
                    checked={selected.includes(row.id)}
                    onCheckedChange={() => toggleSelected(row.id)}
                    aria-label={`Compare ${displayName(row)}`}
                    disabled={!selected.includes(row.id) && selected.length >= MAX_SELECTED}
                  />
                </td>
                <td className="px-3 py-2">
                  <Link href={`/people/${row.id}`} className="font-medium hover:underline">
                    {displayName(row)}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {row.stageLabel ?? "No stage"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{row.dateCount}</td>
                <td className="px-3 py-2 text-right">
                  <RatingDisplay value={row.overallRating} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.avgRating === null ? "—" : row.avgRating.toFixed(1)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.avgChemistry === null ? "—" : row.avgChemistry.toFixed(1)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.totalSpentCents > 0 ? formatMoney(row.totalSpentCents) : "—"}
                </td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                  {row.lastInteractionAt
                    ? `${Math.round((now.getTime() - row.lastInteractionAt.getTime()) / 86_400_000)}d`
                    : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  {row.greenFlags > 0 ? <span className="text-[var(--success)]">{row.greenFlags}↑ </span> : null}
                  {row.redFlags > 0 ? <span className="text-[var(--warning)]">{row.redFlags}↓ </span> : null}
                  {row.dealbreakers > 0 ? <span className="text-destructive">{row.dealbreakers}✕</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {chosen.length >= 2 ? (
        <SideBySide rows={chosen} onClear={() => setSelected([])} unit={unit} />
      ) : (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Columns2 className="size-3.5" />
          Tick two or three people to hold them side by side.
        </p>
      )}
    </div>
  );
}

function SideBySide({
  rows,
  onClear,
  unit,
}: {
  rows: CompareItem[];
  onClear: () => void;
  unit: Unit;
}) {
  const fields: Array<{ label: string; render: (row: CompareItem) => React.ReactNode }> = [
    { label: "Stage", render: (r) => r.stageLabel ?? "—" },
    { label: "Dates", render: (r) => r.dateCount },
    { label: "Overall", render: (r) => <RatingDisplay value={r.overallRating} /> },
    { label: "Chemistry", render: (r) => <RatingDisplay value={r.chemistryScore} /> },
    { label: "Avg date", render: (r) => (r.avgRating === null ? "—" : r.avgRating.toFixed(1)) },
    { label: "Spent", render: (r) => (r.totalSpentCents > 0 ? formatMoney(r.totalSpentCents) : "—") },
    { label: "Met via", render: (r) => r.sourceLabel ?? "—" },
    { label: "Wants kids", render: (r) => KIDS_LABELS[r.wantsKids] ?? "—" },
    { label: "Style", render: (r) => r.relationshipStyle ?? "—" },
    { label: "Living", render: (r) => r.livingSituation ?? "—" },
    { label: "Distance", render: (r) => formatStoredKm(r.distanceKm, unit) ?? "—" },
    { label: "Born", render: (r) => r.birthYear ?? "—" },
    { label: "Religion", render: (r) => r.religion ?? "—" },
    { label: "Politics", render: (r) => r.politics ?? "—" },
    { label: "MBTI", render: (r) => r.mbti ?? "—" },
    {
      label: "Flags",
      render: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.greenFlags > 0 ? <Badge variant="success">{r.greenFlags} green</Badge> : null}
          {r.redFlags > 0 ? <Badge variant="warning">{r.redFlags} red</Badge> : null}
          {r.dealbreakers > 0 ? <Badge variant="destructive">{r.dealbreakers} dealbreaker</Badge> : null}
          {r.greenFlags + r.redFlags + r.dealbreakers === 0 ? "—" : null}
        </span>
      ),
    },
  ];

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Side by side</h3>
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </div>

      <div className="scroll-x rounded-xl border border-border">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="w-28 px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                &nbsp;
              </th>
              {rows.map((row) => (
                <th key={row.id} className="px-3 py-2 text-left font-semibold">
                  <Link href={`/people/${row.id}`} className="hover:underline">
                    {displayName(row)}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.label} className="border-b border-border/60 last:border-0">
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  {field.label}
                </th>
                {rows.map((row) => (
                  <td key={row.id} className="px-3 py-2">
                    {field.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
