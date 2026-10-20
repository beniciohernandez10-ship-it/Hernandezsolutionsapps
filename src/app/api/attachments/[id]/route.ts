import { api } from "@/lib/http/api";
import { openAttachment } from "@/lib/attachments/service";

export const dynamic = "force-dynamic";

/**
 * Authorised download. Files are served from this origin with a sandboxing
 * CSP and nosniff; only raster images may be shown inline.
 */
export const GET = api(async ({ req, principal, params }) => {
  const { info, stream } = await openAttachment(principal, params.id);
  const inline = info.inline && req.nextUrl.searchParams.get("inline") === "1";
  const encoded = encodeURIComponent(info.filename);
  const ascii = info.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(stream, {
    headers: {
      "content-type": info.contentType,
      "content-length": String(info.sizeBytes),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; sandbox",
      "cache-control": "private, no-store",
      "cross-origin-resource-policy": "same-origin",
    },
  });
});
