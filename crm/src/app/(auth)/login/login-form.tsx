"use client";

import { useActionState } from "react";
import { Input, Field } from "@/components/ui/input";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { loginAction } from "../actions";

export function LoginForm() {
  const [state, action] = useActionState(loginAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Email">
        <Input name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingText="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
