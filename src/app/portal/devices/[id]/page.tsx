import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePrincipal } from "@/lib/auth/current";
import { getAsset } from "@/lib/assets/service";
import { KIND_LABEL } from "@/lib/assets/naming";
import { qrMatrix } from "@/lib/assets/qr";
import { AppError } from "@/lib/errors";
import { PageTransition } from "@/components/page-transition";
import { ComplianceBadge } from "@/components/badges";
import { Time } from "@/components/time";
import { IconBack } from "@/components/icons";
import { AssetLabel } from "@/components/asset-label";
import { AssetControls } from "./controls";
import { LabelDownload } from "../labels/download";

export const metadata = { title: "Device" };

const ACTION: Record<string, string> = {
  registered: "Registered",
  user_changed: "Primary user changed",
  location_changed: "Location changed",
  notes_changed: "Notes updated",
  retired: "Retired",
  reactivated: "Reactivated",
};

function describe(action: string, d: Record<string, unknown>) {
  if (action === "user_changed" || action === "location_changed") {
    return `${(d.from as string) ?? "none"} → ${(d.to as string) ?? "none"}`;
  }
  if (action === "registered") return [d.tag, d.primaryUser, d.location].filter(Boolean).join(" · ");
  return "";
}

export default async function AssetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { principal } = await requirePrincipal(`/portal/devices/${id}`);
  let a;
  try {
    a = await getAsset(principal, id);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  const qr = qrMatrix(a.qrUrl);
  const multi = principal.memberships.length > 1;
  return (
    <PageTransition>
      <Link href="/portal/devices" className="subtle back-link" transitionTypes={["nav-back"]}>
        <IconBack size={16} /> All devices
      </Link>
      {sp.created && (
        <div className="alert alert-success" role="status">
          <div>
            <strong>Registered as {a.tag}.</strong> Print the label below and set this name on the PC.
          </div>
        </div>
      )}
      <div className="page-head">
        <div>
          <p className="eyebrow">{multi ? `${a.customerName} · ` : ""}{KIND_LABEL[a.kind]}</p>
          <h1>{a.tag}</h1>
          {a.status === "retired" && <span className="badge">Retired</span>}
        </div>
      </div>
      <div className="detail-grid">
        <div className="stack">
          <section className="card stack" aria-labelledby="label-h">
            <h2 id="label-h">Label</h2>
            <div className="label-preview">
              <AssetLabel tag={a.tag} qr={qr} id="asset-label-svg" />
            </div>
            <p className="subtle">For 24 mm TZe tape on the Brother P-touch D610BT. The QR code opens this page after sign-in.</p>
            <div className="row">
              <Link className="btn btn-primary" href={`/portal/devices/labels?ids=${a.id}`}>Print label</Link>
              <LabelDownload svgId="asset-label-svg" tag={a.tag} />
            </div>
          </section>
          <section className="card stack" aria-labelledby="hist-h">
            <h2 id="hist-h">History</h2>
            <ol className="timeline">
              {a.history.map((h, i) => (
                <li key={i}>
                  <strong>{ACTION[h.action] ?? h.action}</strong>
                  {describe(h.action, h.details) && <span> · {describe(h.action, h.details)}</span>}
                  <span className="subtle"> · {h.actorName ?? "Unknown"} · <Time iso={h.at} /></span>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <aside className="stack">
          <section className="card stack" aria-labelledby="det-h">
            <h2 id="det-h" className="eyebrow">Details</h2>
            <dl className="kv">
              <dt>Primary user</dt>
              <dd>{a.primaryUserName ?? "Shared / none"}{a.primaryUserUpn && <><br /><span className="subtle">{a.primaryUserUpn}</span></>}</dd>
              <dt>Location</dt>
              <dd>{a.location ?? "Not set"}</dd>
              <dt>Seen in</dt>
              <dd>
                {a.linkedDevice ? (
                  <>
                    {a.linkedDevice.source === "intune" ? "Intune" : a.linkedDevice.source === "atera" ? "Atera" : "Demo data"}{" "}
                    <ComplianceBadge state={a.linkedDevice.complianceState} />
                  </>
                ) : (
                  <span className="subtle">No PC named {a.tag} has reported in yet</span>
                )}
              </dd>
              <dt>Registered</dt>
              <dd><Time iso={a.createdAt} />{a.createdByName && <> by {a.createdByName}</>}</dd>
            </dl>
            {a.notes && <p className="prewrap">{a.notes}</p>}
          </section>
          {a.canEdit && (
            <AssetControls
              id={a.id}
              customerId={a.customerId}
              version={a.version}
              status={a.status}
              location={a.location ?? ""}
              notes={a.notes ?? ""}
              primaryUser={a.primaryUserName ? { name: a.primaryUserName, upn: a.primaryUserUpn } : null}
            />
          )}
        </aside>
      </div>
    </PageTransition>
  );
}
