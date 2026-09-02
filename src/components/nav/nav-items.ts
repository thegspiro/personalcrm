export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Also highlight this item for these path prefixes. */
  match?: string[];
}

/** Bottom tab bar on mobile; the same list drives the desktop sidebar. */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Home", icon: "House" },
  { href: "/people", label: "People", icon: "Users", match: ["/people"] },
  { href: "/timeline", label: "Timeline", icon: "History", match: ["/timeline"] },
  { href: "/dating", label: "Dating", icon: "Heart", match: ["/dating"] },
  {
    href: "/more",
    label: "More",
    icon: "Menu",
    match: ["/more", "/settings", "/tasks", "/ideas", "/gifts", "/family", "/locations"],
  },
];

// The bottom bar's five slots are full, so Family lives here — reachable from
// the sidebar on a desktop and from /more on a phone.
export const SECONDARY_NAV: NavItem[] = [
  { href: "/locations", label: "Places", icon: "MapPin", match: ["/locations"] },
  { href: "/family", label: "Family", icon: "Home", match: ["/family"] },
  { href: "/tasks", label: "Follow-ups", icon: "ListChecks" },
  { href: "/ideas", label: "Ideas", icon: "Lightbulb" },
  { href: "/gifts", label: "Gifts", icon: "Gift" },
  { href: "/settings", label: "Settings", icon: "Settings" },
];

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") return pathname === "/";
  const prefixes = item.match ?? [item.href];
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Drop Dating from a nav list when the module is hidden.
 *
 * The route itself also redirects — a nav item is a convenience, not a
 * boundary — but leaving the link visible would defeat the point of hiding it.
 */
export function visibleNav(items: NavItem[], hideDating: boolean): NavItem[] {
  if (!hideDating) return items;
  return items.filter((item) => item.href !== "/dating");
}
