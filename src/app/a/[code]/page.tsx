import { notFound, redirect } from "next/navigation";
import { requirePrincipal } from "@/lib/auth/current";
import { resolveShortCode } from "@/lib/assets/service";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const metadata = { title: "Device", robots: { index: false, follow: false } };

/** Target of the QR code on a device label. Sign-in is required; the code alone grants nothing. */
export default async function ShortCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { principal } = await requirePrincipal(`/a/${encodeURIComponent(code)}`);
  let id: string;
  try {
    id = await resolveShortCode(principal, code);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  redirect(`/portal/devices/${id}`);
}
