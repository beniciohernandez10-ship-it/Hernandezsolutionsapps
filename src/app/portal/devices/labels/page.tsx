import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { getAsset, listAssets } from "@/lib/assets/service";
import { qrMatrix } from "@/lib/assets/qr";
import { AppError } from "@/lib/errors";
import { AssetLabel } from "@/components/asset-label";
import { IconBack } from "@/components/icons";
import { PrintButton } from "./print-button";

export const metadata = { title: "Print labels" };

// Page-scoped print rules live in public/label-print.css. A plain <link> (no
// `precedence`) is rendered in place and removed when the page unmounts, so the
// 64 x 24 mm paper size never leaks into other pages after client navigation.
// An inline <style> would be refused by the CSP on client-side navigation.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LabelsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { principal } = await requirePrincipal("/portal/devices/labels");
  const ids = (sp.ids ?? "").split(",").filter((x) => UUID.test(x)).slice(0, 100);
  let assets;
  if (ids.length) {
    const found = await Promise.all(
      ids.map((id) =>
        getAsset(principal, id).catch((e) => {
          if (e instanceof AppError && e.status === 404) return null;
          throw e;
        }),
      ),
    );
    assets = found.filter((a) => a !== null).map((a) => ({ id: a.id, tag: a.tag, qrUrl: a.qrUrl }));
  } else {
    const { assetQrUrl } = await import("@/lib/assets/service");
    assets = (await listAssets(principal)).map((a) => ({ id: a.id, tag: a.tag, qrUrl: assetQrUrl(a.shortCode) }));
  }
  return (
    <div className="stack">
      <link rel="stylesheet" href="/label-print.css" media="print" />
      <div className="no-print stack">
        <Link href="/portal/devices" className="subtle back-link" transitionTypes={["nav-back"]}>
          <IconBack size={16} /> All devices
        </Link>
        <h1>Print {assets.length} label{assets.length === 1 ? "" : "s"}</h1>
        <div className="card stack">
          <p>
            In the print dialog choose <strong>Brother PT-D610BT</strong>, set the tape to <strong>24 mm</strong>, margins to
            none and scale to 100%. Each label prints on its own 64 mm length of tape.
          </p>
          <p className="subtle">Printing from a phone over Bluetooth? Use “Download PNG” on a device page and open it in the Brother P-touch Design&amp;Print 2 app.</p>
          <div className="row">
            <PrintButton disabled={assets.length === 0} />
          </div>
        </div>
      </div>
      <div className="label-sheet">
        {assets.map((a) => (
          <div key={a.id} className="label-page">
            <AssetLabel tag={a.tag} qr={qrMatrix(a.qrUrl)} />
          </div>
        ))}
      </div>
    </div>
  );
}
