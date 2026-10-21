import { requirePrincipal } from "@/lib/auth/current";
import { listDevices } from "@/lib/tickets/service";
import { AppError } from "@/lib/errors";
import { ComplianceBadge, SyncBadge } from "@/components/badges";
import { Time } from "@/components/time";
import { PageTransition } from "@/components/page-transition";
import { IconDevice, IconPlus } from "@/components/icons";
import Link from "next/link";
import { listAssets, registrableCustomers, warrantyExpiring } from "@/lib/assets/service";
import { listLicenses } from "@/lib/integrations/licenses";
import { KIND_LABEL } from "@/lib/assets/naming";

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
  const [assets, warranties, licenses] = await Promise.all([listAssets(principal), warrantyExpiring(principal), listLicenses(principal)]);
  const canRegister = registrableCustomers(principal).length > 0;
  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">Devices</p>
          <h1>Devices</h1>
        </div>
        {canRegister && (
          <div className="row">
            {assets.length > 0 && <Link className="btn" href="/portal/devices/labels">Print all labels</Link>}
            <Link className="btn btn-primary" href="/portal/devices/new" transitionTypes={["nav-forward"]}>
              <IconPlus size={18} /> Register device
            </Link>
          </div>
        )}
      </div>
      <section className="stack" aria-labelledby="reg-h">
        <h2 id="reg-h">Registered devices</h2>
        {assets.length === 0 ? (
          <p className="subtle">
            {canRegister
              ? "No devices registered yet. Registering a device gives it the next name (WRKSTN-001, LAPTOP-001), a primary user, a location and a QR label."
              : "No devices have been registered for your organization yet."}
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Registered devices with type, primary user, location and whether the PC has reported in</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  {multi && <th scope="col">Organization</th>}
                  <th scope="col">Type</th>
                  <th scope="col">Primary user</th>
                  <th scope="col">Location</th>
                  <th scope="col">Reported in</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}>
                    <th scope="row">
                      <Link href={`/portal/devices/${a.id}`} transitionTypes={["nav-forward"]}>{a.tag}</Link>
                    </th>
                    {multi && <td>{a.customerName}</td>}
                    <td>{KIND_LABEL[a.kind]}</td>
                    <td>{a.primaryUserName ?? <span className="subtle">Shared</span>}</td>
                    <td>{a.location ?? <span className="subtle">Not set</span>}</td>
                    <td>{a.linkedDevice ? <ComplianceBadge state={a.linkedDevice.complianceState} /> : <span className="subtle">Not yet</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {warranties.length > 0 && (
        <section className="stack" aria-labelledby="war-h">
          <h2 id="war-h">Warranties ending in the next 60 days</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Device</th>
                  {multi && <th scope="col">Organization</th>}
                  <th scope="col">Model</th>
                  <th scope="col">Warranty ends</th>
                </tr>
              </thead>
              <tbody>
                {warranties.map((w) => (
                  <tr key={w.id}>
                    <th scope="row"><Link href={`/portal/devices/${w.id}`}>{w.tag}</Link></th>
                    {multi && <td>{w.customerName}</td>}
                    <td>{[w.manufacturer, w.model].filter(Boolean).join(" ") || "—"}</td>
                    <td>{w.warrantyExpires}{w.warrantyExpires! < new Date().toISOString().slice(0, 10) ? " (expired)" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {licenses.some((l) => l.rows.length || l.sync) && (
        <section className="stack" aria-labelledby="lic-h">
          <h2 id="lic-h">Microsoft 365 licenses</h2>
          {licenses
            .filter((l) => l.rows.length || l.sync)
            .map((l) => (
              <div key={l.customerId} className="stack">
                {multi && <h3 className="eyebrow">{l.customerName}</h3>}
                {l.rows.length > 0 && (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">License</th>
                          <th scope="col">Purchased</th>
                          <th scope="col">Assigned</th>
                          <th scope="col">Unassigned</th>
                        </tr>
                      </thead>
                      <tbody>
                        {l.rows.map((r) => (
                          <tr key={r.skuId}>
                            <th scope="row">
                              {r.name ?? r.skuPartNumber}
                              {r.name && <span className="subtle"> · {r.skuPartNumber}</span>}
                            </th>
                            <td>{r.enabled}{r.warning ? ` (+${r.warning} expiring)` : ""}</td>
                            <td>{r.consumed}</td>
                            <td>{r.available}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {l.sync && (
                  <p className="subtle">
                    Read from Microsoft 365{l.sync.lastSuccessAt ? <> · updated <Time iso={l.sync.lastSuccessAt} /></> : ""}. Unassigned licenses may be ones you&apos;re paying for but not using.
                    {l.sync.lastError && l.sync.status !== "synchronized" && <> {l.sync.lastError}</>}
                  </p>
                )}
              </div>
            ))}
        </section>
      )}
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
                    <strong>{s.provider === "intune" ? "Microsoft Intune" : s.provider === "microsoft365" ? "Microsoft 365 licenses" : "Atera"}</strong>
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
        <h2 id="dev-h">Inventory from Intune and Atera: {data.devices.length} device{data.devices.length === 1 ? "" : "s"}</h2>
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
        <p className="subtle">The inventory is read-only. The IT Center cannot wipe, restart, rename or run anything on your devices.</p>
      </section>
    </PageTransition>
  );
}
