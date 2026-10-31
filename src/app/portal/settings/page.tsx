import { requirePrincipal } from "@/lib/auth/current";
import { capabilities } from "@/lib/authz";
import { emailSendingEnabled } from "@/lib/config";
import { getPreferences } from "@/lib/notify/service";
import { delegationOptions } from "@/lib/catalog/workflow";
import { todayPacific } from "@/lib/billing/service";
import { DelegationForm } from "./delegation";
import { PageTransition } from "@/components/page-transition";
import { PreferencesForm } from "./form";
import { AppearanceControl } from "./appearance";
import { cookies } from "next/headers";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { principal } = await requirePrincipal("/portal/settings");
  const caps = capabilities(principal);
  const [prefs, delegation] = await Promise.all([getPreferences(principal), delegationOptions(principal)]);
  const saved = (await cookies()).get("itc-theme")?.value;
  const theme = saved === "light" || saved === "dark" ? saved : "system";
  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">{principal.email}</p>
          <h1>Settings</h1>
        </div>
      </div>
      <AppearanceControl initial={theme} />
      <h2>Email</h2>
      {!emailSendingEnabled() && (
        <p className="alert alert-warning">
          <span>Email isn&apos;t switched on for the IT Center yet. Your choices are saved and apply once it is. In-app notifications always work.</span>
        </p>
      )}
      <PreferencesForm initial={prefs} staff={caps.staff} clientAdmin={principal.memberships.some((m) => m.role === "client_admin")} />
      {delegation.canDelegate && (
        <>
          <h2>Approvals while you&apos;re away</h2>
          <DelegationForm people={delegation.people} delegations={delegation.delegations} today={todayPacific()} />
        </>
      )}
    </PageTransition>
  );
}
