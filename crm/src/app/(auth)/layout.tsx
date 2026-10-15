import { APP_SHORT_NAME, POSITIONING } from "@/lib/constants";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-10">
      <div className="mb-6 flex flex-col items-center text-center">
        <div className="mb-3 flex size-11 items-center justify-center rounded-lg bg-nav text-sm font-bold tracking-wide text-white shadow">HS</div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Hernandez Solutions</p>
        <h1 className="mt-1 text-xl font-semibold">{APP_SHORT_NAME}</h1>
        <p className="mt-1 text-xs text-subtle">{POSITIONING}</p>
      </div>
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-sm">{children}</div>
    </div>
  );
}
