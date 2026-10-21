"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError, fieldErrors } from "@/components/client-api";
import { CATEGORIES, CATEGORY_LABEL, PRIORITIES, PRIORITY_LABEL } from "@/lib/tickets/schemas";
import { IconAlert } from "@/components/icons";

interface Props {
  orgs: { id: string; name: string }[];
  devices: { id: string; name: string; customerId: string }[];
  /** Organizations with the AI assistant turned on. */
  aiOrgs?: string[];
}

const PRIORITY_HELP: Record<string, string> = {
  low: "Whenever you get a chance",
  normal: "Affects my work, workaround exists",
  high: "I can't work normally",
  urgent: "Business is stopped or a security issue",
};

export function NewTicketForm({ orgs, devices, aiOrgs = [] }: Props) {
  const router = useRouter();
  // One key per form instance: retries after a network error can't create duplicates.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [customerId, setCustomerId] = useState(orgs.length === 1 ? orgs[0].id : "");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const visibleDevices = devices.filter((d) => d.customerId === customerId);
  // Knowledge-base articles that might answer the request, refreshed as the person types.
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<{ id: string; title: string; summary: string }[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 4) {
      setSuggestions([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const r = await apiFetch<{ items: { id: string; title: string; summary: string }[] }>(`/api/kb/suggest?q=${encodeURIComponent(text.slice(0, 300))}`);
        setSuggestions(r.items.slice(0, 4));
      } catch {
        setSuggestions([]);
      }
    }, 450);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [text]);
  // Optional AI answer built only from the suggested help articles.
  const formRef = useRef<HTMLFormElement>(null);
  const [help, setHelp] = useState<{ answer: string | null; sources: { id: string; title: string }[] } | null>(null);
  const [helpBusy, setHelpBusy] = useState(false);
  const [helpError, setHelpError] = useState<string | null>(null);
  const aiOn = Boolean(customerId) && aiOrgs.includes(customerId);
  async function askAssistant() {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    setHelpBusy(true);
    setHelpError(null);
    try {
      setHelp(
        await apiFetch("/api/ai/self-help", {
          method: "POST",
          body: { customerId, title: String(fd.get("title") ?? ""), description: String(fd.get("description") ?? "") },
        }),
      );
    } catch (e) {
      setHelpError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setHelpBusy(false);
    }
  }
  const onText = (e: React.FormEvent<HTMLFormElement>) => {
    const fd = new FormData(e.currentTarget);
    setText(`${fd.get("title") ?? ""} ${fd.get("description") ?? ""}`);
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      title: String(fd.get("title") ?? ""),
      description: String(fd.get("description") ?? ""),
      priority: String(fd.get("priority") ?? ""),
      category: String(fd.get("category") ?? ""),
      ...(customerId ? { customerId } : {}),
      ...(fd.get("deviceId") ? { deviceId: String(fd.get("deviceId")) } : {}),
    };
    const local: Record<string, string> = {};
    if (body.title.trim().length < 3) local.title = "Give your request a short title (at least 3 characters).";
    if (!body.description.trim()) local.description = "Describe what's happening.";
    if (!body.priority) local.priority = "Choose how urgent this is.";
    if (!body.category) local.category = "Choose a category.";
    if (!customerId) local.customerId = "Choose an organization.";
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    setFormError(null);
    try {
      const r = await apiFetch<{ id: string }>("/api/tickets", { method: "POST", body, headers: { "idempotency-key": idempotencyKey } });
      router.push(`/portal/tickets/${r.id}?created=1`, { transitionTypes: ["nav-forward"] } as never);
    } catch (err) {
      setErrors(fieldErrors(err));
      setFormError(err instanceof ApiError ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  const err = (k: string) =>
    errors[k] ? (
      <p className="field-error" id={`${k}-err`}>
        <IconAlert size={16} /> {errors[k]}
      </p>
    ) : null;

  return (
    <form ref={formRef} className="card stack" onSubmit={onSubmit} onInput={onText} noValidate>
      {formError && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>
            <strong>Your request wasn&apos;t submitted</strong>
            {formError} Your text is still here, so you can try again.
          </div>
        </div>
      )}
      {orgs.length > 1 && (
        <div className="field">
          <label htmlFor="customerId">Organization</label>
          <select id="customerId" className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-invalid={Boolean(errors.customerId)} aria-describedby={errors.customerId ? "customerId-err" : undefined}>
            <option value="">Choose…</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          {err("customerId")}
        </div>
      )}
      <div className="field">
        <label htmlFor="title">Title</label>
        <input id="title" name="title" className="input" maxLength={200} required autoComplete="off" placeholder="For example: Outlook keeps asking for my password" aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? "title-err" : undefined} />
        {err("title")}
      </div>
      <div className="field">
        <label htmlFor="description">What&apos;s happening?</label>
        <span className="hint" id="description-hint">Include what you were doing, any error message, and when it started. Never include passwords.</span>
        <textarea id="description" name="description" className="textarea" maxLength={20000} required aria-invalid={Boolean(errors.description)} aria-describedby={`description-hint${errors.description ? " description-err" : ""}`} />
        {err("description")}
      </div>
      {suggestions.length > 0 && (
        <aside className="kb-suggest" aria-live="polite" aria-label="Articles that might help">
          <strong>These might help right away</strong>
          <ul>
            {suggestions.map((s) => (
              <li key={s.id}>
                <Link href={`/portal/kb/${s.id}`} target="_blank" rel="noopener">{s.title}</Link>
                {s.summary && <span className="subtle"> · {s.summary}</span>}
              </li>
            ))}
          </ul>
          <span className="subtle">They open in a new tab, so you won&apos;t lose what you&apos;ve typed.</span>
          {aiOn && !help && (
            <div className="row">
              <button className="btn" type="button" onClick={askAssistant} disabled={helpBusy || text.trim().length < 10}>
                {helpBusy && <span className="spinner" aria-hidden />}
                {helpBusy ? "Reading the articles…" : "Get steps from the assistant"}
              </button>
            </div>
          )}
          {helpError && (
            <p className="field-error" role="alert">
              <IconAlert size={16} /> {helpError}
            </p>
          )}
          {help && (
            <div className="ai-output stack" role="status">
              {help.answer ? (
                <>
                  <strong>Try this first</strong>
                  <p className="prewrap">{help.answer}</p>
                  <span className="subtle">
                    Written by AI from{" "}
                    {help.sources.map((s, i) => (
                      <span key={s.id}>
                        {i > 0 && ", "}
                        <Link href={`/portal/kb/${s.id}`} target="_blank" rel="noopener">{s.title}</Link>
                      </span>
                    ))}
                    . If it doesn&apos;t fix things, submit your request below.
                  </span>
                </>
              ) : (
                <span className="subtle">Our help articles don&apos;t cover this one. Submit your request and a technician will help.</span>
              )}
            </div>
          )}
        </aside>
      )}
      <fieldset className="field" aria-describedby={errors.priority ? "priority-err" : undefined}>
        <legend className="label">How urgent is it?</legend>
        <div className="radio-cards">
          {PRIORITIES.map((p) => (
            <label key={p}>
              <input type="radio" name="priority" value={p} defaultChecked={p === "normal"} />
              <span>
                {PRIORITY_LABEL[p]}
                <br />
                <span className="subtle">{PRIORITY_HELP[p]}</span>
              </span>
            </label>
          ))}
        </div>
        {err("priority")}
      </fieldset>
      <div className="form-grid two">
        <div className="field">
          <label htmlFor="category">Category</label>
          <select id="category" name="category" className="select" defaultValue="general" aria-invalid={Boolean(errors.category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
          {err("category")}
        </div>
        {visibleDevices.length > 0 && (
          <div className="field">
            <label htmlFor="deviceId">Related device (optional)</label>
            <select id="deviceId" name="deviceId" className="select" defaultValue="">
              <option value="">None</option>
              {visibleDevices.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy && <span className="spinner" aria-hidden />} {busy ? "Submitting…" : "Submit request"}
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => router.back()} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}
