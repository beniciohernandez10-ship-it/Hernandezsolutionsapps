"use client";

import { ChevronsLeft, ChevronsRight, LogOut, Menu, Moon, Search, Sun, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { initials, cn } from "@/lib/utils";
import { ICONS } from "./icons";
import { GROUP_LABEL, NAV_ITEMS, type NavItem } from "./nav-items";

interface ShellUser {
  name: string;
  email: string;
  role: string;
}

function useActive() {
  const pathname = usePathname();
  const params = useSearchParams();
  return (item: NavItem) => {
    const [path, query] = item.href.split("?");
    if (path === "/") return pathname === "/";
    if (query) {
      const [k, v] = query.split("=");
      return pathname === path && params.get(k) === v;
    }
    if (path === "/leads") return pathname.startsWith("/leads") && !params.get("view");
    return pathname === path || pathname.startsWith(`${path}/`);
  };
}

const RANK: Record<string, number> = { VIEWER: 1, SALES: 2, ADMIN: 3, OWNER: 4 };

function NavList({ role, collapsed, onNavigate }: { role: string; collapsed?: boolean; onNavigate?: () => void }) {
  const isActive = useActive();
  const groups = (["work", "leads", "insight", "admin"] as const).map((g) => ({
    g,
    items: NAV_ITEMS.filter((i) => i.group === g && RANK[role] >= RANK[i.minRole ?? "VIEWER"]),
  }));
  return (
    <nav className="flex flex-col gap-4">
      {groups.map(({ g, items }) => (
        <div key={g} className="flex flex-col gap-0.5">
          {!collapsed ? <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-nav-fg/50">{GROUP_LABEL[g]}</p> : null}
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-nav-fg transition-colors hover:bg-nav-active hover:text-white",
                  active && "bg-nav-active font-medium text-white shadow-[inset_2px_0_0_var(--accent)]",
                  collapsed && "justify-center px-0",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {!collapsed ? <span className="truncate">{item.label}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = React.useState<string | null>(null);
  React.useEffect(() => setTheme(document.documentElement.dataset.theme ?? "light"), []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("hs-theme", next);
    } catch {}
    setTheme(next);
  };
  return (
    <button onClick={toggle} className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Switch light or dark mode">
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

function GlobalSearch({ className }: { className?: string }) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !(e.target as HTMLElement).closest("input,textarea,select,[contenteditable]"))) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form
      role="search"
      className={cn("relative", className)}
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`/leads?q=${encodeURIComponent(q.trim())}&view=all`);
      }}
    >
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search prospects, contacts, phone…"
        aria-label="Search prospects"
        className="h-9 w-full rounded-md border border-border bg-surface-2 pl-8 pr-12 text-sm placeholder:text-subtle focus:border-accent focus:bg-surface focus:outline-none"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 text-[10px] text-subtle sm:block">Ctrl K</kbd>
    </form>
  );
}

export function AppShell({ user, children, logout }: { user: ShellUser; children: React.ReactNode; logout: () => Promise<void> }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("hs-sidebar") === "collapsed");
    } catch {}
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("hs-sidebar", c ? "open" : "collapsed");
      } catch {}
      return !c;
    });
  };

  const brand = (small?: boolean) => (
    <Link href="/" className="flex items-center gap-2.5 px-1">
      {/* eslint-disable-next-line @next/next/no-img-element -- small static brand mark */}
      <img src="/brand/mark.png" alt="" width={32} height={32} className="size-8 shrink-0 rounded-md" />
      {!small ? (
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[11px] uppercase tracking-[0.14em] text-nav-fg/70">Hernandez Solutions</span>
          <span className="block truncate text-sm font-semibold text-white">Lead Command Center</span>
        </span>
      ) : null}
    </Link>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col bg-nav px-3 py-4 transition-[width] md:flex", collapsed ? "w-[68px]" : "w-60")}>
        <div className="mb-6">{brand(collapsed)}</div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <NavList role={user.role} collapsed={collapsed} />
        </div>
        <button
          onClick={toggleCollapsed}
          className="mt-3 flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs text-nav-fg/70 hover:bg-nav-active hover:text-white"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" /> Collapse</>}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-3 backdrop-blur md:px-6">
          <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
            <DialogTrigger className="rounded-md p-2 text-muted hover:bg-surface-2 md:hidden" aria-label="Open menu">
              <Menu className="size-5" />
            </DialogTrigger>
            <DialogContent title="Menu" side="left" className="bg-nav text-nav-fg [&_h2]:text-white">
              <NavList role={user.role} onNavigate={() => setMobileOpen(false)} />
            </DialogContent>
          </Dialog>
          <GlobalSearch className="min-w-0 flex-1 md:max-w-md" />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <Dropdown>
              <DropdownTrigger className="flex items-center gap-2 rounded-md p-1 hover:bg-surface-2" aria-label="Account menu">
                <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{initials(user.name)}</span>
              </DropdownTrigger>
              <DropdownContent>
                <DropdownLabel>
                  <span className="block font-medium text-fg">{user.name}</span>
                  <span className="block">{user.email}</span>
                </DropdownLabel>
                <DropdownSeparator />
                <DropdownItem asChild>
                  <Link href="/account"><UserRound /> Account and security</Link>
                </DropdownItem>
                <DropdownItem onSelect={() => void logout()}>
                  <LogOut /> Sign out
                </DropdownItem>
              </DropdownContent>
            </Dropdown>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-3 pb-24 pt-5 md:px-6 md:pb-10">{children}</main>
        <MobileTabBar />
      </div>
    </div>
  );
}

function MobileTabBar() {
  const pathname = usePathname();
  const tabs = [
    { href: "/calls", label: "Calls", icon: ICONS.PhoneCall },
    { href: "/follow-ups", label: "Follow-ups", icon: ICONS.AlarmClock },
    { href: "/leads", label: "Prospects", icon: ICONS.Building2 },
    { href: "/pipeline", label: "Pipeline", icon: ICONS.KanbanSquare },
    { href: "/", label: "Home", icon: ICONS.LayoutDashboard },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Quick navigation">
      {tabs.map((t) => {
        const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
        const Icon = t.icon;
        return (
          <Link key={t.href} href={t.href} className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", active ? "text-accent" : "text-muted")}>
            <Icon className="size-5" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
