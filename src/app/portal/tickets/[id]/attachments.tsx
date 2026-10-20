"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiUpload, ApiError } from "@/components/client-api";
import { IconAlert, IconLock, IconPaperclip } from "@/components/icons";
import { Time } from "@/components/time";

export interface AttachmentView {
  id: string;
  filename: string;
  sizeBytes: number;
  visibility: "public" | "internal";
  uploaderName: string;
  inline: boolean;
  source: "portal" | "email";
  createdAt: string;
}

const ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.heic,.heif,.pdf,.docx,.xlsx,.pptx,.txt,.log,.csv,.md";

function size(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentPanel({
  ticketId,
  attachments,
  canUpload,
  canInternal,
  enabled,
}: {
  ticketId: string;
  attachments: AttachmentView[];
  canUpload: boolean;
  canInternal: boolean;
  enabled: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files).slice(0, 5)) {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("visibility", internal ? "internal" : "public");
        try {
          await apiUpload(`/api/tickets/${ticketId}/attachments`, fd);
        } catch (e) {
          setError(`${file.name}: ${e instanceof ApiError ? e.message : "upload failed."}`);
          break;
        }
      }
      start(() => router.refresh());
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <section className="card tight stack" aria-labelledby="files-h">
      <h2 id="files-h" className="eyebrow">Files</h2>
      {attachments.length === 0 ? (
        <p className="subtle">No files yet.</p>
      ) : (
        <ul className="stack" role="list">
          {attachments.map((a) => (
            <li key={a.id} className="attachment">
              <a href={`/api/attachments/${a.id}`} download={a.filename} className="attachment-name">
                <IconPaperclip size={14} /> {a.filename}
              </a>
              <span className="subtle">
                {size(a.sizeBytes)} · {a.uploaderName}
                {a.source === "email" ? " · by email" : ""} · <Time iso={a.createdAt} />
              </span>
              {a.visibility === "internal" && (
                <span className="badge internal">
                  <IconLock size={13} /> Technicians only
                </span>
              )}
              {a.inline && (
                <a className="subtle" href={`/api/attachments/${a.id}?inline=1`} target="_blank" rel="noopener noreferrer">
                  View
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {canUpload && enabled && (
        <div className="stack">
          <div className="row">
            {canInternal && (
              <label className="check">
                <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Technicians only
              </label>
            )}
            <input
              ref={input}
              id="file-upload"
              type="file"
              className="sr-only"
              multiple
              accept={ACCEPT}
              onChange={(e) => upload(e.target.files)}
              disabled={busy || pending}
            />
            <label htmlFor="file-upload" className={`btn${busy || pending ? " is-busy" : ""}`} aria-disabled={busy || pending}>
              {busy && <span className="spinner" aria-hidden />}
              <IconPaperclip size={15} /> {busy ? "Uploading…" : "Add files"}
            </label>
          </div>
          <p className="subtle">Screenshots, PDFs, Office files or text logs, up to 4 MB each. Files are private to this request and aren&apos;t virus-scanned, so only open files you expect.</p>
        </div>
      )}
      {canUpload && !enabled && <p className="subtle">File uploads aren&apos;t set up yet.</p>}
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>{error}</div>
        </div>
      )}
    </section>
  );
}
