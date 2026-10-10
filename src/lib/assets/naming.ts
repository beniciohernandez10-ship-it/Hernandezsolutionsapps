export const ASSET_KINDS = ["workstation", "laptop"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const KIND_PREFIX: Record<AssetKind, string> = { workstation: "WRKSTN", laptop: "LAPTOP" };
export const KIND_LABEL: Record<AssetKind, string> = { workstation: "Workstation", laptop: "Laptop" };

/** Windows computer names are limited to 15 characters (NetBIOS). */
export const MAX_NAME_LENGTH = 15;

/** WRKSTN-001 … WRKSTN-999, then WRKSTN-1000 and up (still within 15 characters). */
export function formatAssetTag(kind: AssetKind, n: number) {
  if (!Number.isInteger(n) || n < 1) throw new Error("Asset number must be a positive integer.");
  const tag = `${KIND_PREFIX[kind]}-${String(n).padStart(3, "0")}`;
  if (tag.length > MAX_NAME_LENGTH) throw new Error("Asset name would exceed the Windows 15-character limit.");
  return tag;
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/1/l/o: easy to read off a label

export function newShortCode(random: (n: number) => Uint8Array) {
  const bytes = random(10);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}
