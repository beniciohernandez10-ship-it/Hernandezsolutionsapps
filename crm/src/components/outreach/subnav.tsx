import Link from "next/link";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/outreach", label: "Approval queue" },
  { href: "/outreach/compose", label: "Write an email" },
  { href: "/outreach/sequences", label: "Sequences" },
  { href: "/outreach/templates", label: "Templates" },
];

export function OutreachNav({ active }: { active: string }) {
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-border scrollbar-thin" aria-label="Email outreach">
      {ITEMS.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm", active === i.href ? "border-accent font-medium text-fg" : "border-transparent text-muted hover:text-fg")}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
