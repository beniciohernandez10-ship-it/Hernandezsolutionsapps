import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mfaQrDataUrl, newMfaSecret, verifyTotp } from "@/lib/auth/mfa";

/**
 * RFC 6238 Appendix B test vectors (SHA-1, 30 s step). The seed is the ASCII
 * string "12345678901234567890"; authenticator apps use its Base32 form. The
 * RFC lists 8-digit codes, and a 6-digit code is the last six digits.
 */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const VECTORS: [seconds: number, code: string][] = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
];

const at = (seconds: number) => vi.setSystemTime(new Date(seconds * 1000));

describe("two-factor codes (TOTP)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("matches the RFC 6238 reference codes, so existing authenticator apps keep working", async () => {
    vi.useFakeTimers();
    for (const [seconds, code] of VECTORS) {
      at(seconds);
      expect(await verifyTotp(RFC_SECRET, code), `code ${code} at ${seconds}s`).toBe(true);
    }
  });

  it("accepts the previous 30-second code but nothing older", async () => {
    vi.useFakeTimers();
    at(59 + 30);
    expect(await verifyTotp(RFC_SECRET, "287082")).toBe(true);
    at(59 + 60);
    expect(await verifyTotp(RFC_SECRET, "287082")).toBe(false);
  });

  it("rejects wrong and malformed codes, and ignores spaces", async () => {
    vi.useFakeTimers();
    at(59);
    expect(await verifyTotp(RFC_SECRET, "287083")).toBe(false);
    expect(await verifyTotp(RFC_SECRET, "28708")).toBe(false);
    expect(await verifyTotp(RFC_SECRET, "2870822")).toBe(false);
    expect(await verifyTotp(RFC_SECRET, "abcdef")).toBe(false);
    expect(await verifyTotp(RFC_SECRET, "")).toBe(false);
    expect(await verifyTotp(RFC_SECRET, "287 082")).toBe(true);
  });

  it("creates 160-bit Base32 secrets that verify their own codes", async () => {
    const secret = newMfaSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/); // 20 bytes = 32 Base32 characters
    expect(newMfaSecret()).not.toBe(secret);
  });

  it("renders a QR code for authenticator apps", async () => {
    const url = await mfaQrDataUrl("owner@example.com", RFC_SECRET);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
  });
});

/** verifyTotp is async: a missing await makes `!verifyTotp(...)` always false, so any code would pass. */
it("every caller awaits verifyTotp", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  };
  walk(path.join(process.cwd(), "src"));
  const unawaited = files.flatMap((f) =>
    readFileSync(f, "utf8")
      .split(/\r?\n/)
      .map((line, i) => ({ line, at: `${path.relative(process.cwd(), f)}:${i + 1}` }))
      .filter(({ line }) => /verifyTotp\(/.test(line) && !/await verifyTotp\(|function verifyTotp/.test(line)),
  );
  expect(unawaited.map((u) => u.at)).toEqual([]);
});
