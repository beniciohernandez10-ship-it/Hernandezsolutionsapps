import { NextResponse } from "next/server";
import { api } from "@/lib/http/api";
import { AppError } from "@/lib/errors";
import { config } from "@/lib/config";
import { uploadAttachment } from "@/lib/attachments/service";
import { drainAfterResponse } from "@/lib/http/after-response";

export const dynamic = "force-dynamic";

/** One file per request, as multipart/form-data with fields "file" and "visibility". */
export const POST = api(
  async ({ req, principal, params }) => {
    if (!(req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      throw new AppError(415, "bad_request", "Expected a file upload.");
    }
    const max = config().attachments.maxUploadBytes;
    if (Number(req.headers.get("content-length") ?? 0) > max + 64 * 1024) {
      throw new AppError(413, "validation_failed", `Files can be up to ${Math.round(max / 1024 / 1024)} MB.`, { field: "file" });
    }
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new AppError(400, "bad_request", "The upload could not be read.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError(422, "validation_failed", "Choose a file.", { field: "file" });
    const result = await uploadAttachment(principal, {
      ticketId: params.id,
      filename: file.name,
      data: new Uint8Array(await file.arrayBuffer()),
      visibility: form.get("visibility") === "internal" ? "internal" : "public",
    });
    drainAfterResponse();
    return NextResponse.json(result, { status: 201, headers: { "cache-control": "no-store" } });
  },
  { rate: [30, 300] },
);
