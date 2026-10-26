import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";

/** Accept the current 30-second code and its neighbours (clock drift on phones). */
const TOLERANCE_SECONDS = 30;

export function newMfaSecret(): string {
  return generateSecret({ length: 20 });
}

export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  const token = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(token)) return false;
  try {
    const result = await verify({ secret, token, epochTolerance: TOLERANCE_SECONDS });
    return result.valid;
  } catch {
    // Malformed or too-short secret: never treat as a match.
    return false;
  }
}

export async function mfaQrDataUrl(email: string, secret: string): Promise<string> {
  const uri = generateURI({ issuer: "HS Lead Command Center", label: email, secret });
  return QRCode.toDataURL(uri, { margin: 1, width: 220 });
}
