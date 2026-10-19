import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Set up" };

export default async function SetupPage() {
  if ((await db.user.count()) > 0) redirect("/login");
  return (
    <>
      <h2 className="text-base font-semibold">Create the owner account</h2>
      <p className="mb-4 mt-1 text-sm text-muted">
        This works once, while there are no users. You need the <code className="rounded bg-surface-2 px-1">SETUP_TOKEN</code> value from the environment settings.
      </p>
      <SetupForm />
    </>
  );
}
