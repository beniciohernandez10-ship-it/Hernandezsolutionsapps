import { authenticator } from "otplib";
import QRCode from "qrcode";

authenticator.options = { window: 1, step: 30 };

export function newMfaSecret(): string {
  return authenticator.generateSecret(20);
}

export function verifyTotp(secret: string, code: string): boolean {
  const token = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(token)) return false;
  return authenticator.check(token, secret);
}

export async function mfaQrDataUrl(email: string, secret: string): Promise<string> {
  const uri = authenticator.keyuri(email, "HS Lead Command Center", secret);
  return QRCode.toDataURL(uri, { margin: 1, width: 220 });
}
