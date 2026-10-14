/** Client IP for rate limiting. On Vercel the platform sets x-forwarded-for; elsewhere configure a trusted proxy. */
export function clientIp(req: Request) {
  const xff = req.headers.get("x-forwarded-for");
  return (xff?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown").slice(0, 64);
}
