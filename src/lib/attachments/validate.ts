/**
 * Attachment acceptance rules. The type is identified from the file's bytes
 * and must agree with its extension; anything not on the list is refused.
 * Active content is never accepted: no HTML, SVG, scripts, executables,
 * archives, or Office files containing macros.
 */
export interface Accepted {
  contentType: string;
  /** Safe to show inline in the browser (raster images only). */
  inline: boolean;
  filename: string;
}

export class AttachmentRejected extends Error {}

const TYPES: { ext: string[]; type: string; inline?: boolean; test: (b: Uint8Array) => boolean }[] = [
  { ext: ["png"], type: "image/png", inline: true, test: (b) => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { ext: ["jpg", "jpeg"], type: "image/jpeg", inline: true, test: (b) => starts(b, [0xff, 0xd8, 0xff]) },
  { ext: ["gif"], type: "image/gif", inline: true, test: (b) => ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a" },
  { ext: ["webp"], type: "image/webp", inline: true, test: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP" },
  { ext: ["heic", "heif"], type: "image/heic", test: (b) => ascii(b, 4, 8) === "ftyp" && ["heic", "heix", "hevc", "mif1", "msf1"].includes(ascii(b, 8, 12)) },
  { ext: ["pdf"], type: "application/pdf", test: (b) => ascii(b, 0, 5) === "%PDF-" },
  { ext: ["docx"], type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", test: (b) => ooxml(b, "word/") },
  { ext: ["xlsx"], type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", test: (b) => ooxml(b, "xl/") },
  { ext: ["pptx"], type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", test: (b) => ooxml(b, "ppt/") },
  { ext: ["txt", "log", "csv", "md"], type: "text/plain; charset=utf-8", test: (b) => isPlainText(b) },
];

export const ALLOWED_EXTENSIONS = TYPES.flatMap((t) => t.ext);

function starts(b: Uint8Array, sig: number[]) {
  return b.length >= sig.length && sig.every((v, i) => b[i] === v);
}

function ascii(b: Uint8Array, from: number, to: number) {
  return b.length >= to ? String.fromCharCode(...b.subarray(from, to)) : "";
}

function includesAscii(b: Uint8Array, needle: string) {
  return Buffer.from(b.buffer, b.byteOffset, b.byteLength).includes(needle, 0, "latin1");
}

/** An Office Open XML zip for the given part folder, without a VBA macro project. */
function ooxml(b: Uint8Array, folder: string) {
  if (!starts(b, [0x50, 0x4b, 0x03, 0x04])) return false;
  if (!includesAscii(b, "[Content_Types].xml") || !includesAscii(b, folder)) return false;
  if (includesAscii(b, "vbaProject.bin") || includesAscii(b, "vbaData.xml")) throw new AttachmentRejected("Office files with macros can't be attached.");
  return true;
}

function isPlainText(b: Uint8Array) {
  const sample = b.subarray(0, 64 * 1024);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample.length === b.length ? sample : trimPartialUtf8(sample));
  } catch {
    return false;
  }
  const head = new TextDecoder().decode(sample.subarray(0, 1024)).trimStart().toLowerCase();
  // Markup that a browser would render is not "plain text".
  return !/^(<!doctype|<html|<svg|<\?xml|<script)/.test(head);
}

/** Drops an incomplete multi-byte sequence at the end of a sample. */
function trimPartialUtf8(b: Uint8Array) {
  let end = b.length;
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const c = b[end - i];
    if ((c & 0xc0) === 0x80) continue;
    if (c >= 0xc0) end -= i;
    break;
  }
  return b.subarray(0, end);
}

/** Display name: no paths, control characters or quotes, bounded length. */
export function cleanFilename(raw: string) {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  if (!cleaned) return "file";
  if (cleaned.length <= 150) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, 150 - ext.length) + ext;
}

export function checkAttachment(filename: string, data: Uint8Array, maxBytes: number): Accepted {
  if (data.byteLength === 0) throw new AttachmentRejected("The file is empty.");
  if (data.byteLength > maxBytes) throw new AttachmentRejected(`Files can be up to ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const name = cleanFilename(filename);
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const byExt = TYPES.find((t) => t.ext.includes(ext));
  if (!byExt) throw new AttachmentRejected(`.${ext || "?"} files can't be attached. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}.`);
  if (!byExt.test(data)) throw new AttachmentRejected("The file's contents don't match its type.");
  return { contentType: byExt.type, inline: Boolean(byExt.inline), filename: name };
}
