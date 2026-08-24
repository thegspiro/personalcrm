"use client";

import * as Lucide from "lucide-react";
import { CircleDot } from "lucide-react";
import type { LucideProps } from "lucide-react";

type IconComponent = React.ComponentType<LucideProps>;

/**
 * Resolve a Lucide icon by name.
 *
 * Icon names come from user-editable taxonomy rows, so an unknown or renamed
 * icon must degrade to a placeholder rather than crash the page.
 */
export function Icon({ name, ...props }: { name?: string | null } & LucideProps) {
  const registry = Lucide as unknown as Record<string, IconComponent>;
  const Component = (name && registry[name]) || CircleDot;
  return <Component {...props} />;
}
