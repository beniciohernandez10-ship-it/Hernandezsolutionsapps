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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
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
