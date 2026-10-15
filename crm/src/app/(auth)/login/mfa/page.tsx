import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { MfaForm } from "./mfa-form";

export const metadata = { title: "Two-step sign-in" };

export default async function MfaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.mfaEnabled || user.mfaVerified) redirect("/");
  return (
    <>
      <h2 className="text-base font-semibold">Two-step sign-in</h2>
      <p className="mb-4 mt-1 text-sm text-muted">Enter the 6-digit code from your authenticator app.</p>
      <MfaForm />
    </>
  );
}
