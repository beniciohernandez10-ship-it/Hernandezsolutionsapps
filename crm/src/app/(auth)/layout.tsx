import { APP_SHORT_NAME, POSITIONING } from "@/lib/constants";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-10">
      <div className="mb-6 flex flex-col items-center text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand lockup */}
        <img src="/brand/logo.png" alt="Hernandez Solutions" width={720} height={413} className="mb-4 h-auto w-64 rounded-xl shadow" />
        <h1 className="text-xl font-semibold">{APP_SHORT_NAME}</h1>
        <p className="mt-1 text-xs text-subtle">{POSITIONING}</p>
      </div>
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-sm">{children}</div>
    </div>
  );
}
