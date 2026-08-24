import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Deterministic slug for taxonomy terms, tags, and custom-field keys. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function initialsOf(firstName: string, lastName?: string | null): string {
  const a = firstName?.trim()?.[0] ?? "";
  const b = lastName?.trim()?.[0] ?? "";
  return (a + b).toUpperCase() || "?";
}

export function displayName(c: {
  firstName: string;
  lastName?: string | null;
  nickname?: string | null;
}): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || c.nickname || "Unnamed";
}
