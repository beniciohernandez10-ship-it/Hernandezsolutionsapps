import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user && (!user.mfaEnabled || user.mfaVerified)) redirect("/");
  if (user && user.mfaEnabled && !user.mfaVerified) redirect("/login/mfa");
  const hasUsers = (await db.user.count()) > 0;
  return (
    <>
      <h2 className="mb-4 text-base font-semibold">Sign in</h2>
      <LoginForm />
      {!hasUsers ? (
        <p className="mt-4 text-center text-xs text-muted">
          First time here? <Link href="/setup" className="text-accent hover:underline">Create the owner account</Link>
        </p>
      ) : null}
    </>
  );
}
