"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  IconBell,
  IconBook,
  IconCalendar,
  IconChart,
  IconClock,
  IconDevice,
  IconGear,
  IconHome,
  IconInbox,
  IconLayers,
  IconList,
  IconPlus,
  IconPulse,
  IconReply,
  IconSearch,
} from "./icons";

const ICONS = {
  home: IconHome,
  list: IconList,
  layers: IconLayers,
  plus: IconPlus,
  book: IconBook,
  pulse: IconPulse,
  device: IconDevice,
  calendar: IconCalendar,
  search: IconSearch,
  chart: IconChart,
  clock: IconClock,
  inbox: IconInbox,
  gear: IconGear,
  bell: IconBell,
  reply: IconReply,
};

export type NavIcon = keyof typeof ICONS;

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Small count shown at the end of the row (e.g. unread notifications). */
  count?: number;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

function isActive(pathname: string, href: string) {
  return href === "/portal" ? pathname === "/portal" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Grouped navigation for the sidebar and the phone menu sheet. */
export function NavGroups({ groups, label = "Portal" }: { groups: NavGroup[]; label?: string }) {
  const pathname = usePathname();
  // Deepest match wins so "/portal/tickets/new" highlights "New request", not "Tickets".
  const all = groups.flatMap((g) => g.items);
  const active = all.filter((i) => isActive(pathname, i.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label={label} className="nav-groups">
      {groups
        .filter((g) => g.items.length)
        .map((g, n) => (
          <div key={g.label ?? n} className="nav-group">
            {g.label && <div className="nav-group-label">{g.label}</div>}
            {g.items.map((i) => {
              const Icon = ICONS[i.icon];
              return (
                <Link key={i.href} href={i.href} className="nav-item" aria-current={i.href === active ? "page" : undefined} transitionTypes={["nav-forward"]}>
                  <Icon size={16} strokeWidth={1.75} />
                  <span>{i.label}</span>
                  {i.count ? (
                    <span className="nav-count">
                      {i.count > 99 ? "99+" : i.count}
                      <span className="sr-only"> unread</span>
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
    </nav>
  );
}

/**
 * The phone menu is a native <details>; the layout stays mounted between pages,
 * so close it after navigating, on Escape, and on a tap outside it.
 */
export function MenuAutoClose() {
  const pathname = usePathname();
  useEffect(() => {
    document.querySelectorAll<HTMLDetailsElement>("details.mobile-menu[open]").forEach((d) => (d.open = false));
  }, [pathname]);
  useEffect(() => {
    const close = (except?: EventTarget | null) =>
      document.querySelectorAll<HTMLDetailsElement>("details.mobile-menu[open]").forEach((d) => {
        if (!(except instanceof Node && d.contains(except))) d.open = false;
      });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onPointer = (e: PointerEvent) => close(e.target);
    // A link inside the menu always closes it (the path may not change).
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("details.mobile-menu a")) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("click", onClick);
    };
  }, []);
  return null;
}
