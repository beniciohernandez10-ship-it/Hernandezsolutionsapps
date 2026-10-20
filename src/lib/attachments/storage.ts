import { config } from "../config";
import { AppError } from "../errors";

/**
 * Where attachment bytes live. Production uses a *private* Vercel Blob store:
 * nothing is reachable by URL, every read goes through the portal's
 * authorised download route. Local development writes under .data/, and tests
 * use memory. Keys are random and never derived from file names.
 */
export interface AttachmentStorage {
  readonly kind: "vercel-blob" | "filesystem" | "memory";
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  /** Returns the bytes as a stream, or null if missing. */
  get(key: string): Promise<ReadableStream<Uint8Array> | null>;
  delete(key: string): Promise<void>;
}

class BlobStorage implements AttachmentStorage {
  readonly kind = "vercel-blob" as const;
  async put(key: string, data: Uint8Array, contentType: string) {
    const { put } = await import("@vercel/blob");
    await put(key, Buffer.from(data), { access: "private", contentType, addRandomSuffix: false, allowOverwrite: false });
  }
  async get(key: string) {
    const { get } = await import("@vercel/blob");
    const r = await get(key, { access: "private", useCache: false });
    return r && r.statusCode === 200 ? r.stream : null;
  }
  async delete(key: string) {
    const { del } = await import("@vercel/blob");
    await del(key);
  }
}

class FileStorage implements AttachmentStorage {
  readonly kind = "filesystem" as const;
  constructor(private dir: string) {}
  private async file(key: string) {
    const path = await import("node:path");
    if (!/^[a-z0-9/-]+$/.test(key)) throw new Error("bad key");
    return path.join(this.dir, ...key.split("/"));
  }
  async put(key: string, data: Uint8Array) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const f = await this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, data, { flag: "wx" });
  }
  async get(key: string) {
    const fs = await import("node:fs/promises");
    try {
      return streamOf(new Uint8Array(await fs.readFile(await this.file(key))));
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    const fs = await import("node:fs/promises");
    await fs.rm(await this.file(key), { force: true });
  }
}

export class MemoryStorage implements AttachmentStorage {
  readonly kind = "memory" as const;
  readonly files = new Map<string, Uint8Array>();
  async put(key: string, data: Uint8Array) {
    if (this.files.has(key)) throw new Error("exists");
    this.files.set(key, data);
  }
  async get(key: string) {
    const d = this.files.get(key);
    return d ? streamOf(d) : null;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}

function streamOf(d: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      c.enqueue(d);
      c.close();
    },
  });
}

let override: AttachmentStorage | undefined;
export function setStorageForTesting(s: AttachmentStorage | undefined) {
  override = s;
}

// On Vercel the SDK authenticates with the deployment's OIDC token; BLOB_STORE_ID is set when a store is connected.
const blobConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

export function attachmentStorage(): AttachmentStorage {
  if (override) return override;
  if (blobConfigured()) return new BlobStorage();
  if (!config().isDeployed) return new FileStorage("./.data/attachments");
  throw new AppError(503, "not_configured", "File attachments aren't set up yet.");
}

export const attachmentsEnabled = () => Boolean(override) || blobConfigured() || !config().isDeployed;
