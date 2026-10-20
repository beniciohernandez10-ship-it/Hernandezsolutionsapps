/**
 * Central configuration. Values come from server-side environment variables
 * only; nothing here is exposed to browser bundles (no NEXT_PUBLIC_ values).
 */
export interface AppConfig {
  appOrigin: string;
  websiteUrl: string;
  databaseUrl?: string;
  databaseSsl: boolean;
  dbPoolMax: number;
  pgliteDir: string;
  isDeployed: boolean;
  isProduction: boolean;
  demoMode: boolean;
  sessionIdleMinutes: number;
  sessionAbsoluteHours: number;
  reauthMinutes: number;
  reopenWindowDays: number;
  entra: {
    clientId?: string;
    clientSecret?: string;
    authorityHost: string;
    authorityTenant: string;
  };
  graph: {
    clientId?: string;
    clientSecret?: string;
    baseUrl: string;
  };
  atera: { baseUrl: string };
  email: {
    /** Resend API key; without it notifications stay in-app only. */
    resendApiKey?: string;
    /** Verified sender, e.g. "Hernandez Solutions IT Center <support@thehernandezsolutions.com>". */
    from?: string;
    /** Domain whose mail Resend receives; enables reply-by-email and intake. */
    inboundDomain?: string;
    /** Signing secret of the Resend "email.received" webhook. */
    webhookSecret?: string;
  };
  attachments: { maxUploadBytes: number; maxEmailBytes: number };
  cronSecret?: string;
}

let cached: AppConfig | undefined;

function bool(v: string | undefined, fallback = false) {
  if (v === undefined || v === "") return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

function int(v: string | undefined, fallback: number) {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): AppConfig {
  const isDeployed = Boolean(env.VERCEL_ENV) || env.ITC_DEPLOYED === "true";
  const isProduction = env.VERCEL_ENV === "production" || env.ITC_ENV === "production";
  return {
    appOrigin: (env.APP_ORIGIN ?? "http://localhost:3000").replace(/\/$/, ""),
    websiteUrl: env.WEBSITE_URL ?? "https://thehernandezsolutions.com",
    databaseUrl: env.DATABASE_URL || undefined,
    databaseSsl: bool(env.DATABASE_SSL, true),
    dbPoolMax: int(env.DB_POOL_MAX, 5),
    pgliteDir: env.PGLITE_DATA_DIR ?? "./.data/pglite",
    isDeployed,
    isProduction,
    // Demo personas are never available in production deployments.
    demoMode: bool(env.DEMO_MODE) && !isProduction,
    sessionIdleMinutes: int(env.SESSION_IDLE_MINUTES, 120),
    sessionAbsoluteHours: int(env.SESSION_ABSOLUTE_HOURS, 12),
    reauthMinutes: int(env.REAUTH_MINUTES, 15),
    reopenWindowDays: int(env.REOPEN_WINDOW_DAYS, 14),
    entra: {
      clientId: env.ENTRA_CLIENT_ID || undefined,
      clientSecret: env.ENTRA_CLIENT_SECRET || undefined,
      authorityHost: env.ENTRA_AUTHORITY_HOST ?? "https://login.microsoftonline.com",
      authorityTenant: env.ENTRA_AUTHORITY_TENANT ?? "organizations",
    },
    graph: {
      clientId: env.GRAPH_CLIENT_ID || undefined,
      clientSecret: env.GRAPH_CLIENT_SECRET || undefined,
      baseUrl: env.GRAPH_BASE_URL ?? "https://graph.microsoft.com",
    },
    atera: { baseUrl: env.ATERA_BASE_URL ?? "https://app.atera.com" },
    email: {
      resendApiKey: env.RESEND_API_KEY || undefined,
      from: env.EMAIL_FROM || undefined,
      inboundDomain: env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase() || undefined,
      webhookSecret: env.RESEND_WEBHOOK_SECRET || undefined,
    },
    // Uploads pass through a Vercel Function (4.5 MB request limit); email attachments are fetched server-side.
    attachments: { maxUploadBytes: 4 * 1024 * 1024, maxEmailBytes: 10 * 1024 * 1024 },
    cronSecret: env.CRON_SECRET || undefined,
  };
}

export function config(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

export function setConfigForTesting(next: Partial<AppConfig> | undefined) {
  cached = next ? { ...loadConfig({}), ...next } : undefined;
}

export function secureCookies() {
  return config().appOrigin.startsWith("https://");
}

/** Outbound email is configured (API key and a sender). */
export const emailSendingEnabled = () => Boolean(config().email.resendApiKey && config().email.from);
/** Inbound email is configured (sending, plus a receiving domain and webhook secret). */
export const emailIntakeEnabled = () => emailSendingEnabled() && Boolean(config().email.inboundDomain && config().email.webhookSecret);
