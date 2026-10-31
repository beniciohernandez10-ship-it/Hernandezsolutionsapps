"use client";
import type { ApprovalStep, ApproverRef } from "@/lib/catalog/workflow";

export interface Candidate {
  id: string;
  name: string;
  customerId: string;
  customerName: string;
}

const OPS: { value: NonNullable<ApprovalStep["condition"]>["op"]; label: string }[] = [
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "greater_than", label: "is more than" },
  { value: "less_than", label: "is less than" },
];

const encode = (a: ApproverRef) => (a.type === "default" ? "default" : a.type === "role" ? `role:${a.role}` : `user:${a.userId}`);
const decode = (v: string): ApproverRef =>
  v === "default" ? { type: "default" } : v.startsWith("role:") ? { type: "role", role: v.slice(5) as "client_admin" | "service_manager" } : { type: "user", userId: v.slice(5) };

/** Approval steps for a catalog item: in order, each with approvers who decide in parallel, optionally only when an answer matches. */
export function StepsEditor({
  steps,
  onChange,
  questions,
  candidates,
  customerId,
  idPrefix,
}: {
  steps: ApprovalStep[];
  onChange: (s: ApprovalStep[]) => void;
  questions: string[];
  candidates: Candidate[];
  /** Item offered to one company: only its people can be named. */
  customerId: string | null;
  idPrefix: string;
}) {
  const people = customerId ? candidates.filter((c) => c.customerId === customerId) : candidates;
  const companies = [...new Set(people.map((c) => c.customerName))];
  const setStep = (i: number, patch: Partial<ApprovalStep>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) => {
    const next = [...steps];
    const [s] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + by)), 0, s);
    onChange(next);
  };
  return (
    <fieldset className="stack">
      <legend className="label">Approval steps</legend>
      <p className="subtle">
        Steps run in order; a request is approved when the last one is. Leave this empty and tick &ldquo;Needs the client&apos;s approval&rdquo; for one
        step with the company&apos;s usual approvers. Service managers can always decide, and anyone can delegate while they&apos;re away.
      </p>
      {steps.map((s, i) => {
        const k = `${idPrefix}-st${i}`;
        return (
          <div key={i} className="card tight stack-tight workflow-step">
            <div className="spread">
              <strong>Step {i + 1}</strong>
              <span className="row">
                <button type="button" className="btn btn-ghost" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="btn btn-ghost" aria-label={`Move step ${i + 1} down`} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="btn btn-ghost" onClick={() => onChange(steps.filter((_, j) => j !== i))}>Remove step</button>
              </span>
            </div>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor={`${k}-name`}>Step name</label>
                <input id={`${k}-name`} className="input" value={s.name} maxLength={80} onChange={(e) => setStep(i, { name: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor={`${k}-mode`}>Who has to approve</label>
                <select id={`${k}-mode`} className="select" value={s.mode} onChange={(e) => setStep(i, { mode: e.target.value as "any" | "all" })}>
                  <option value="any">Any one of them</option>
                  <option value="all">All of them (in parallel)</option>
                </select>
              </div>
            </div>
            {s.approvers.map((a, j) => (
              <div key={j} className="row">
                <label className="sr-only" htmlFor={`${k}-a${j}`}>Approver {j + 1}</label>
                <select
                  id={`${k}-a${j}`}
                  className="select"
                  value={encode(a)}
                  onChange={(e) => setStep(i, { approvers: s.approvers.map((x, n) => (n === j ? decode(e.target.value) : x)) })}
                >
                  <option value="default">The company&apos;s usual approvers</option>
                  <option value="role:client_admin">The client&apos;s administrators</option>
                  <option value="role:service_manager">Hernandez Solutions service managers</option>
                  {companies.map((c) => (
                    <optgroup key={c} label={c}>
                      {people
                        .filter((x) => x.customerName === c)
                        .map((x) => (
                          <option key={`${x.customerId}-${x.id}`} value={`user:${x.id}`}>{x.name}</option>
                        ))}
                    </optgroup>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={s.approvers.length === 1}
                  onClick={() => setStep(i, { approvers: s.approvers.filter((_, n) => n !== j) })}
                >
                  Remove
                </button>
              </div>
            ))}
            <div>
              <button type="button" className="btn" disabled={s.approvers.length >= 6} onClick={() => setStep(i, { approvers: [...s.approvers, { type: "default" }] })}>
                Add an approver
              </button>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={s.condition !== null}
                disabled={!questions.length}
                onChange={(e) => setStep(i, { condition: e.target.checked ? { field: questions[0] ?? "", op: "equals", value: "" } : null })}
              />{" "}
              Only when an answer matches
            </label>
            {s.condition && (
              <div className="row">
                <label className="sr-only" htmlFor={`${k}-cf`}>Question</label>
                <select id={`${k}-cf`} className="select" value={s.condition.field} onChange={(e) => setStep(i, { condition: { ...s.condition!, field: e.target.value } })}>
                  {questions.map((q) => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </select>
                <label className="sr-only" htmlFor={`${k}-co`}>Comparison</label>
                <select id={`${k}-co`} className="select" value={s.condition.op} onChange={(e) => setStep(i, { condition: { ...s.condition!, op: e.target.value as typeof OPS[number]["value"] } })}>
                  {OPS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <label className="sr-only" htmlFor={`${k}-cv`}>Value</label>
                <input id={`${k}-cv`} className="input" value={s.condition.value} maxLength={200} placeholder="e.g. 1000" onChange={(e) => setStep(i, { condition: { ...s.condition!, value: e.target.value } })} />
              </div>
            )}
          </div>
        );
      })}
      <div>
        <button
          type="button"
          className="btn"
          disabled={steps.length >= 6}
          onClick={() => onChange([...steps, { name: steps.length ? `Step ${steps.length + 1}` : "Manager approval", mode: "any", approvers: [{ type: "default" }], condition: null }])}
        >
          Add a step
        </button>
      </div>
    </fieldset>
  );
}
