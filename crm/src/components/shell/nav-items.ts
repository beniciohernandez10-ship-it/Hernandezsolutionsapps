export interface NavItem {
  href: string;
  label: string;
  icon: string;
  minRole?: "VIEWER" | "SALES" | "ADMIN" | "OWNER";
  group: "work" | "leads" | "insight" | "admin";
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "LayoutDashboard", group: "work" },
  { href: "/calls", label: "Call Center", icon: "PhoneCall", group: "work" },
  { href: "/follow-ups", label: "Follow-ups", icon: "AlarmClock", group: "work" },
  { href: "/outreach", label: "Email Outreach", icon: "Mail", group: "work" },
  { href: "/leads", label: "All Prospects", icon: "Building2", group: "leads" },
  { href: "/leads?view=startups", label: "Startups", icon: "Rocket", group: "leads" },
  { href: "/leads?view=veterinary", label: "Veterinary", icon: "PawPrint", group: "leads" },
  { href: "/pipeline", label: "Pipeline", icon: "KanbanSquare", group: "leads" },
  { href: "/clients", label: "Clients", icon: "BadgeCheck", group: "leads" },
  { href: "/analytics", label: "Analytics", icon: "BarChart3", group: "insight" },
  { href: "/import", label: "Import & Export", icon: "Upload", minRole: "SALES", group: "admin" },
  { href: "/settings", label: "Settings", icon: "Settings", group: "admin" },
];

export const GROUP_LABEL: Record<NavItem["group"], string> = {
  work: "Daily work",
  leads: "Prospects",
  insight: "Insight",
  admin: "Admin",
};
