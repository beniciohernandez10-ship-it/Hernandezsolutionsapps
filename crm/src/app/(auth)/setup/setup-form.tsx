"use client";

import { useActionState } from "react";
import { Field, Input } from "@/components/ui/input";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { setupAction } from "../actions";

export function SetupForm() {
  const [state, action] = useActionState(setupAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Setup token">
        <Input name="token" type="password" required autoComplete="off" />
      </Field>
      <Field label="Your name">
        <Input name="name" required autoComplete="name" />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" required autoComplete="username" />
      </Field>
      <Field label="Password" hint="At least 12 characters. A passphrase works well.">
        <Input name="password" type="password" required minLength={12} autoComplete="new-password" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingText="Creating…">Create account</SubmitButton>
    </form>
  );
}
