"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { checkInboxAction, removeSuppressionAction } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/components/ui/form";

export function CheckInboxButton() {
  const router = useRouter();
  const { run, pending } = useServerAction(checkInboxAction);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={async () => {
        await run();
        router.refresh();
      }}
    >
      <RefreshCw className="size-3.5" /> {pending ? "Checking…" : "Check now"}
    </Button>
  );
}

export function RemoveSuppression({ email }: { email: string }) {
  const router = useRouter();
  const { run, pending } = useServerAction(removeSuppressionAction);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={async () => {
        if (!window.confirm(`Allow email to ${email} again? Only do this if they asked you to.`)) return;
        await run(email);
        router.refresh();
      }}
    >
      Remove
    </Button>
  );
}
