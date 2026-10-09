import { requirePrincipal } from "@/lib/auth/current";
import { listDevices } from "@/lib/tickets/service";
import { AppError } from "@/lib/errors";
import { ComplianceBadge, SyncBadge } from "@/components/badges";
import { Time } from "@/components/time";
import { PageTransition } from "@/components/page-transition";
import { IconDevice } from "@/components/icons";

export const metadata = { title: "Devices" };

const STALE_HOURS = 24;

export default async function DevicesPage() {
  const { principal } = await requirePrincipal("/portal/devices");
  let data;
  try {
    data = await listDevices(principal);
  } catch (e) {
    if (e instanceof AppError && e.status === 403) {
      return (
        <PageTransition>
          <h1>Devices</h1>
          <p className="muted">Device inventory is available to your organization&apos;s administrators.</p>
        </PageTransition>
      );
    }
    throw e;
  }
  const multi = new Set(data.devices.map((d) => d.customerId)).size > 1 || principal.memberships.length > 1;
  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">Read-only inventory</p>
          <h1>Devices</h1>
        </div>
      </div>
      <section className="stack" aria-labelledby="sync-h">
        <h2 id="sync-h">Synchronization</h2>
        {data.sync.length === 0 ? (
          <p className="subtle">No device sources are connected yet. Devices appear here after Hernandez Solutions connects Microsoft Intune for your organization.</p>
        ) : (
          <div className="grid grid-stats">
            {data.sync.map((s) => {
              const stale = !s.lastSuccessAt || Date.now() - new Date(s.lastSuccessAt).getTime() > STALE_HOURS * 3600_000;
              return (
                <div key={`${s.customerId}-${s.provider}-${s.resource}`} className="card tight stack">
                  <div className="spread">
                    <strong>{s.provider === "intune" ? "Microsoft Intune" : "Atera"}</strong>
                    <SyncBadge status={s.status} />
                  </div>
                  {multi && <span className="subtle">{s.customerName}</span>}
                  <span className="subtle">
                    Last successful sync: {s.lastSuccessAt ? <Time iso={s.lastSuccessAt} /> : "never"}
                    {stale && s.lastSuccessAt && <strong> · Stale: older than {STALE_HOURS} hours</strong>}
                  </span>
                  {s.lastError && s.status !== "synchronized" && <span className="subtle">{s.lastError}</span>}
                </div>
              );
            })}
          </div>
        )}
      </section>
      <section className="stack" aria-labelledby="dev-h">
        <h2 id="dev-h">{data.devices.length} device{data.devices.length === 1 ? "" : "s"}</h2>
        {data.devices.length === 0 ? (
          <div className="empty">
            <IconDevice size={28} />
            <p>No devices yet.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Devices with operating system, compliance state and last check-in</caption>
              <thead>
                <tr>
                  <th scope="col">Device</th>
                  {multi && <th scope="col">Organization</th>}
                  <th scope="col">Operating system</th>
                  <th scope="col">Compliance</th>
                  <th scope="col">Last check-in</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {data.devices.map((d) => (
                  <tr key={d.id}>
                    <th scope="row">{d.name}</th>
                    {multi && <td>{d.customerName}</td>}
                    <td>{[d.operatingSystem, d.osVersion].filter(Boolean).join(" ") || "—"}</td>
                    <td><ComplianceBadge state={d.complianceState} /></td>
                    <td><Time iso={d.lastProviderSyncAt} /></td>
                    <td>{d.source === "intune" ? "Intune" : d.source === "atera" ? "Atera" : "Demo data"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="subtle">This view is read-only. The IT Center cannot wipe, restart or run anything on your devices.</p>
      </section>
    </PageTransition>
  );
}
