import { requirePrincipal } from "@/lib/auth/current";
import { capabilities } from "@/lib/authz";
import { emailSendingEnabled } from "@/lib/config";
import { getPreferences } from "@/lib/notify/service";
import { PageTransition } from "@/components/page-transition";
import { PreferencesForm } from "./form";

export const metadata = { title: "Email settings" };

export default async function SettingsPage() {
  const { principal } = await requirePrincipal("/portal/settings");
  const caps = capabilities(principal);
  const prefs = await getPreferences(principal);
  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">{principal.email}</p>
          <h1>Email settings</h1>
        </div>
      </div>
      {!emailSendingEnabled() && (
        <p className="alert alert-warning">
          <span>Email isn&apos;t switched on for the IT Center yet. Your choices are saved and apply once it is. In-app notifications always work.</span>
        </p>
      )}
      <PreferencesForm initial={prefs} staff={caps.staff} />
    </PageTransition>
  );
}
