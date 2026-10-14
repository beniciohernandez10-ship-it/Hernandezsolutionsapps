"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
}

function isActive(pathname: string, href: string) {
  return href === "/portal" ? pathname === "/portal" : pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks({ items, className }: { items: NavItem[]; className?: string }) {
  const pathname = usePathname();
  // Deepest match wins so "/portal/tickets/new" highlights "New request", not "Tickets".
  const active = items.filter((i) => isActive(pathname, i.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="Portal" className={className}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={i.href === active ? "page" : undefined} transitionTypes={["nav-forward"]}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
