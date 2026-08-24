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
  { href: "/more", label: "More", icon: "Menu", match: ["/more", "/settings", "/tasks", "/ideas", "/gifts"] },
];

export const SECONDARY_NAV: NavItem[] = [
  { href: "/tasks", label: "Follow-ups", icon: "CircleCheck" },
  { href: "/ideas", label: "Ideas", icon: "Lightbulb" },
  { href: "/gifts", label: "Gifts", icon: "Gift" },
  { href: "/settings", label: "Settings", icon: "Settings" },
];

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") return pathname === "/";
  const prefixes = item.match ?? [item.href];
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
