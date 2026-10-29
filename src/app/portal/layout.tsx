import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { capabilities, ROLE_LABEL, type Principal, type Role } from "@/lib/authz";
import { config } from "@/lib/config";
import { MenuAutoClose, NavGroups, type NavGroup } from "@/components/nav";
import { SignOutButton } from "@/components/signout";
import { IconBell, IconExternal, IconMenu } from "@/components/icons";
import { unreadCount } from "@/lib/notify/service";
import { drainAfterResponse } from "@/lib/http/after-response";
import { activeIncidentsFor } from "@/lib/incidents/service";
import { demoAllowed } from "@/lib/auth/demo";

/** The most senior role, for the account chip. */
function roleLabel(p: Principal) {
  if (p.isOperator) return "Platform operator";
  for (const r of ["service_manager", "technician", "client_admin", "requester"] as Role[]) {
    if (p.memberships.some((m) => m.role === r)) return ROLE_LABEL[r];
  }
  return "No organization yet";
}

/** First and last initials, by grapheme, ignoring a trailing "(Demo)". */
function initials(name: string) {
  const words = name.replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const first = (w?: string) => (w ? ([...seg.segment(w)][0]?.segment ?? "") : "");
  const out = words.length > 1 ? first(words[0]) + first(words[words.length - 1]) : first(words[0]);
  return out.toUpperCase() || "?";
}

function Brand() {
  return (
    <Link href="/portal" className="brand" aria-label="Hernandez Solutions IT Center home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.svg" alt="" width={30} height={30} />
      <span className="brand-text">
        Hernandez Solutions
        <small>IT Center</small>
      </span>
    </Link>
  );
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { principal, csrfToken } = await requirePrincipal();
  const caps = capabilities(principal);
  const member = principal.memberships.length > 0;
  const unread = member ? await unreadCount(principal).catch(() => 0) : 0;
  const incidents = await activeIncidentsFor(principal).catch(() => []);
  // Keeps notifications and SLA checks moving between the daily cron runs.
  drainAfterResponse({ sweep: true });

  const groups: NavGroup[] = [
    {
      items: [
        { href: "/portal", label: "Overview", icon: "home" },
        { href: "/portal/tickets", label: caps.staff ? "Tickets" : "My requests", icon: "list" },
        ...(caps.staff ? [{ href: "/portal/queues", label: "Queues", icon: "layers" as const }] : []),
        ...(caps.staff ? [{ href: "/portal/time", label: "Timesheet", icon: "clock" as const }] : []),
        ...(caps.canCreate ? [{ href: "/portal/tickets/new", label: "New request", icon: "plus" as const }] : []),
        ...(member ? [{ href: "/portal/notifications", label: "Notifications", icon: "bell" as const, count: unread }] : []),
      ],
    },
    {
      label: "Help",
      items: [
        ...(caps.canCreate ? [{ href: "/portal/kb", label: "Knowledge", icon: "book" as const }] : []),
        ...(caps.canCreate ? [{ href: "/portal/status", label: "Service status", icon: "pulse" as const }] : []),
      ],
    },
    {
      label: caps.staff ? "Service management" : "Organization",
      items: [
        ...(caps.orgView ? [{ href: "/portal/changes", label: "Changes", icon: "calendar" as const }] : []),
        ...(caps.staff ? [{ href: "/portal/problems", label: "Problems", icon: "search" as const }] : []),
        ...(caps.orgView ? [{ href: "/portal/devices", label: "Devices", icon: "device" as const }] : []),
        ...(caps.orgView ? [{ href: "/portal/reports", label: "Reports", icon: "chart" as const }] : []),
        ...(caps.staff ? [{ href: "/portal/replies", label: "Saved replies", icon: "reply" as const }] : []),
        ...(caps.manager ? [{ href: "/portal/inbox", label: "Email inbox", icon: "inbox" as const }] : []),
      ],
    },
    ...(caps.operator ? [{ label: "Platform", items: [{ href: "/portal/admin", label: "Administration", icon: "gear" as const }] }] : []),
  ];
  const website = config().websiteUrl;

  const footer = (
    <div className="sidebar-footer">
      <NavGroups groups={[{ items: [{ href: "/portal/settings", label: "Settings", icon: "gear" }] }]} label="Account" />
      <a className="nav-item" href={website}>
        <IconExternal size={16} strokeWidth={1.75} />
        <span>thehernandezsolutions.com</span>
      </a>
      <div className="user-chip">
        <span className="avatar" aria-hidden="true">{initials(principal.displayName)}</span>
        <span className="who">
          <strong title={principal.displayName}>{principal.displayName}</strong>
          <span>{roleLabel(principal)}</span>
        </span>
      </div>
      <SignOutButton className="btn btn-ghost no-print" />
    </div>
  );

  return (
    <>
      <meta name="csrf-token" content={csrfToken} />
      <a href="#main" className="skip-link">Skip to content</a>
      <MenuAutoClose />
      <div className="app-shell">
        <aside className="sidebar" aria-label="Main">
          <Brand />
          <NavGroups groups={groups} />
          {footer}
        </aside>
        <div className="app-main">
          {demoAllowed() && (
            <div className="demo-banner" role="note">
              Local demo with fictional data. Signed in as <strong>{principal.displayName}</strong>.
            </div>
          )}
          <header className="topbar">
            <div className="container bar">
              <Brand />
              <div className="topbar-actions">
                {member && (
                  <Link href="/portal/notifications" className="btn btn-ghost icon-btn" transitionTypes={["nav-forward"]}>
                    <IconBell size={18} strokeWidth={1.75} />
                    <span className="sr-only">Notifications</span>
                    {unread > 0 && (
                      <span className="dot-count">
                        {unread > 99 ? "99+" : unread}
                        <span className="sr-only"> unread</span>
                      </span>
                    )}
                  </Link>
                )}
                <details className="mobile-menu">
                  <summary aria-label="Menu">
                    <IconMenu size={20} strokeWidth={1.75} />
                  </summary>
                  <div className="mobile-panel">
                    <NavGroups groups={groups} label="Portal menu" />
                    {footer}
                  </div>
                </details>
              </div>
            </div>
          </header>
          {incidents.length > 0 && (
            <div className="incident-banner" role="status">
              <div className="container">
                <strong>Known issue{incidents.length > 1 ? "s" : ""}:</strong>{" "}
                {incidents.map((i, n) => (
                  <span key={i.id}>
                    {n > 0 && " · "}
                    <Link href={`/portal/incidents/${i.id}`}>{i.title}</Link>
                  </span>
                ))}
                {" · "}
                <Link href="/portal/status">Service status</Link>
              </div>
            </div>
          )}
          <main id="main">
            <div className="container">{children}</div>
          </main>
          <footer className="site-footer">
            <div className="container spread">
              <span>© Hernandez Solutions LLC · IT Center</span>
              <a href={website}>thehernandezsolutions.com</a>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
