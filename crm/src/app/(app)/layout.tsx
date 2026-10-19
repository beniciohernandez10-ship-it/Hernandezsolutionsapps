import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { getCurrentUser } from "@/lib/auth/session";
import { logoutAction } from "../(auth)/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mfaEnabled && !user.mfaVerified) redirect("/login/mfa");
  return (
    <Suspense>
      <AppShell user={{ name: user.name, email: user.email, role: user.role }} logout={logoutAction}>
        {children}
      </AppShell>
    </Suspense>
  );
}
