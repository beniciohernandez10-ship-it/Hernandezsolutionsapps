// Client Portal link for thehernandezsolutions.com (React / Next.js).
// Reuse the website's existing nav link classes so it matches the current design;
// replace `className` with whatever the neighbouring nav items use.
const PORTAL_URL = "https://portal.thehernandezsolutions.com";

export function ClientPortalLink({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  return (
    <a href={PORTAL_URL} className={className} onClick={onNavigate}>
      Client Portal
    </a>
  );
}

/*
Desktop nav (next to "Pricing" / "Company"):
  <ClientPortalLink className={navLinkClass} />

Mobile menu (inside the existing menu list; pass the menu's close handler):
  <ClientPortalLink className={mobileNavLinkClass} onNavigate={closeMenu} />
*/
