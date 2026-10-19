"use client";

import { Loader2 } from "lucide-react";
import * as React from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions";
import { Button, type ButtonProps } from "./button";
import { Alert } from "./misc";

export function SubmitButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending || props.disabled} {...props}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** A <form> bound to a server action with inline success/error feedback. */
export function ActionForm({
  action,
  children,
  className,
  onSuccess,
  resetOnSuccess,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  onSuccess?: (state: ActionState) => void;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = React.useActionState(action, null);
  const ref = React.useRef<HTMLFormElement>(null);
  const handled = React.useRef<ActionState>(null);
  React.useEffect(() => {
    if (state && state !== handled.current && state.ok) {
      handled.current = state;
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
    }
  }, [state, onSuccess, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      <FormMessage state={state} />
    </form>
  );
}

/** Run a server action from a button click with pending state and an error toast. */
export function useServerAction<A extends unknown[]>(fn: (...args: A) => Promise<ActionState>) {
  const [pending, start] = React.useTransition();
  const [result, setResult] = React.useState<ActionState>(null);
  const run = React.useCallback(
    (...args: A) =>
      new Promise<ActionState>((resolve) => {
        start(async () => {
          const r = await fn(...args);
          setResult(r);
          if (r?.error) window.dispatchEvent(new CustomEvent("hs-toast", { detail: { tone: "danger", text: r.error } }));
          else if (r?.message) window.dispatchEvent(new CustomEvent("hs-toast", { detail: { tone: "success", text: r.message } }));
          resolve(r);
        });
      }),
    [fn],
  );
  return { run, pending, result };
}

export function toast(text: string, tone: "success" | "danger" | "neutral" = "success") {
  window.dispatchEvent(new CustomEvent("hs-toast", { detail: { tone, text } }));
}

export function Toaster() {
  const [items, setItems] = React.useState<{ id: number; tone: string; text: string }[]>([]);
  React.useEffect(() => {
    let n = 0;
    const onToast = (e: Event) => {
      const { tone, text } = (e as CustomEvent).detail as { tone: string; text: string };
      const id = ++n;
      setItems((list) => [...list.slice(-3), { id, tone, text }]);
      setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), 4500);
    };
    window.addEventListener("hs-toast", onToast);
    return () => window.removeEventListener("hs-toast", onToast);
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-[60] flex flex-col gap-2 md:bottom-4" aria-live="polite">
      {items.map((i) => (
        <div
          key={i.id}
          className={
            "pointer-events-auto max-w-sm rounded-md border px-3 py-2 text-sm shadow-lg " +
            (i.tone === "danger" ? "border-danger/30 bg-danger-soft text-danger" : i.tone === "success" ? "border-success/30 bg-success-soft text-success" : "border-border bg-surface text-fg")
          }
        >
          {i.text}
        </div>
      ))}
    </div>
  );
}
