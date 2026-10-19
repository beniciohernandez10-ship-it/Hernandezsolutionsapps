"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { logoutAction, mfaAction } from "../../actions";

export function MfaForm() {
  const [state, action] = useActionState(mfaAction, null);
  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-col gap-4">
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus className="h-11 text-center text-lg tracking-[0.4em]" aria-label="Code" />
        <FormMessage state={state} />
        <SubmitButton className="w-full" pendingText="Checking…">Verify</SubmitButton>
      </form>
      <form action={logoutAction}>
        <button className="w-full text-center text-xs text-muted hover:text-fg">Use a different account</button>
      </form>
    </div>
  );
}
