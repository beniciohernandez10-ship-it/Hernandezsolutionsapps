import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { capabilities } from "@/lib/authz";
import { config } from "@/lib/config";
import { NavLinks, type NavItem } from "@/components/nav";
import { SignOutButton } from "@/components/signout";
import { IconBell, IconExternal, IconMenu } from "@/components/icons";
import { unreadCount } from "@/lib/notify/service";
import { drainAfterResponse } from "@/lib/http/after-response";
import { demoAllowed } from "@/lib/auth/demo";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { principal, csrfToken } = await requirePrincipal();
  const caps = capabilities(principal);
  const unread = principal.memberships.length ? await unreadCount(principal).catch(() => 0) : 0;
  // Keeps notifications and SLA checks moving between the daily cron runs.
  drainAfterResponse({ sweep: true });
  const items: NavItem[] = [
    { href: "/portal", label: "Overview" },
    { href: "/portal/tickets", label: caps.staff ? "Tickets" : "My requests" },
    ...(caps.canCreate ? [{ href: "/portal/tickets/new", label: "New request" }] : []),
    ...(caps.canCreate ? [{ href: "/portal/kb", label: "Knowledge" }] : []),
    ...(caps.orgView ? [{ href: "/portal/devices", label: "Devices" }] : []),
    ...(caps.orgView ? [{ href: "/portal/changes", label: "Changes" }] : []),
    ...(caps.orgView ? [{ href: "/portal/reports", label: "Reports" }] : []),
    ...(caps.manager ? [{ href: "/portal/inbox", label: "Email inbox" }] : []),
    ...(caps.operator ? [{ href: "/portal/admin", label: "Administration" }] : []),
  ];
  const website = config().websiteUrl;
  return (
    <>
      <meta name="csrf-token" content={csrfToken} />
      <a href="#main" className="skip-link">Skip to content</a>
      {demoAllowed() && (
        <div className="demo-banner" role="note">
          Local demo with fictional data. Signed in as <strong>{principal.displayName}</strong>.
        </div>
      )}
      <header className="site-header">
        <div className="container bar">
          <Link href="/portal" className="brand" aria-label="Hernandez Solutions IT Center home">
            Hernandez Solutions <small>IT Center</small>
          </Link>
          <NavLinks items={items} className="nav" />
          <div className="header-actions">
            {principal.memberships.length > 0 && (
              <Link href="/portal/notifications" className="btn btn-ghost bell" transitionTypes={["nav-forward"]}>
                <IconBell size={17} />
                <span className="sr-only">Notifications</span>
                {unread > 0 && (
                  <span className="bell-count">
                    {unread > 99 ? "99+" : unread}
                    <span className="sr-only"> unread</span>
                  </span>
                )}
              </Link>
            )}
            <a className="btn btn-ghost website-link" href={website}>
              thehernandezsolutions.com <IconExternal size={14} />
            </a>
            <span className="sr-only">Signed in as {principal.displayName}</span>
            <div className="nav-signout no-print"><SignOutButton /></div>
            <details className="mobile-menu">
              <summary aria-label="Open menu"><IconMenu /></summary>
              <div className="mobile-panel">
                <NavLinks items={items} />
                <hr />
                <Link href="/portal/notifications">Notifications{unread ? ` (${unread})` : ""}</Link>
                <Link href="/portal/settings">Email settings</Link>
                {caps.staff && <Link href="/portal/replies">Saved replies</Link>}
                <a href={website}>Back to thehernandezsolutions.com</a>
                <SignOutButton className="btn btn-ghost" />
                <p className="subtle">Signed in as {principal.displayName}</p>
              </div>
            </details>
          </div>
        </div>
      </header>
      <main id="main">
        <div className="container">{children}</div>
      </main>
      <footer className="site-footer">
        <div className="container spread">
          <span>© Hernandez Solutions LLC · IT Center</span>
          <a href={website}>Return to thehernandezsolutions.com</a>
        </div>
      </footer>
    </>
  );
}
