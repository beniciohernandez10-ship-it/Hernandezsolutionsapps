"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert } from "@/components/icons";
import type { Survey } from "@/lib/surveys/service";

/** "How did we do?" for the requester; read-only rating for everyone else who can see it. */
export function SurveyCard({ ticketId, survey, canRate, staff }: { ticketId: string; survey: Survey | null; canRate: boolean; staff: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rating, setRating] = useState<"good" | "bad" | null>(survey?.rating ?? null);
  const [comment, setComment] = useState(survey?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canRate) {
    if (!survey) return null;
    return (
      <section className="card tight stack" aria-labelledby="survey-h">
        <h2 id="survey-h" className="eyebrow">{staff ? "Requester's rating" : "Your rating"}</h2>
        <p>
          <strong>{survey.rating === "good" ? "👍 Good" : "👎 Not good"}</strong>
        </p>
        {survey.comment && <p className="prewrap subtle">{survey.comment}</p>}
      </section>
    );
  }

  const send = async (r: "good" | "bad") => {
    setRating(r);
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await apiFetch(`/api/tickets/${ticketId}/survey`, { method: "POST", body: { rating: r, comment: comment.trim() || undefined } });
      setSaved(true);
      start(() => router.refresh());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save your rating.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card tight stack" aria-labelledby="survey-h">
      <h2 id="survey-h" className="eyebrow">How did we do?</h2>
      <div className="row" role="group" aria-labelledby="survey-h">
        <button type="button" className="btn" aria-pressed={rating === "good"} disabled={busy || pending} onClick={() => send("good")}>👍 Good</button>
        <button type="button" className="btn" aria-pressed={rating === "bad"} disabled={busy || pending} onClick={() => send("bad")}>👎 Not good</button>
      </div>
      {rating && (
        <div className="field">
          <label htmlFor="survey-comment">Anything we should know? (optional)</label>
          <textarea id="survey-comment" className="textarea" rows={2} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
          <button type="button" className="btn" disabled={busy || pending} onClick={() => send(rating)}>Save comment</button>
        </div>
      )}
      {saved && <p className="subtle" role="status">Thanks, your feedback was saved. You can change it until the request closes.</p>}
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>{error}</div>
        </div>
      )}
    </section>
  );
}
