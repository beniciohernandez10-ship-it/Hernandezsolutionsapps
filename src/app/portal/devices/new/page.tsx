import { requirePrincipal } from "@/lib/auth/current";
import { registrableCustomers } from "@/lib/assets/service";
import { PageTransition } from "@/components/page-transition";
import { RegisterDeviceForm } from "./form";

export const metadata = { title: "Register device" };

export default async function RegisterDevicePage() {
  const { principal } = await requirePrincipal("/portal/devices/new");
  const orgs = registrableCustomers(principal);
  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">Devices</p>
          <h1>Register a device</h1>
        </div>
      </div>
      {orgs.length === 0 ? (
        <p className="muted">Only Hernandez Solutions technicians can register devices.</p>
      ) : (
        <RegisterDeviceForm orgs={orgs} />
      )}
    </PageTransition>
  );
}
