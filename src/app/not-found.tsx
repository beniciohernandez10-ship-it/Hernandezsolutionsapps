import Link from "next/link";

export default function NotFound() {
  return (
    <div className="auth-shell">
      <div className="card auth-card">
        <p className="eyebrow">Not found</p>
        <h1>We couldn't find that page</h1>
        <p className="muted">It may have moved, or you may not have access to it.</p>
        <Link className="btn btn-primary" href="/portal">Go to the IT Center</Link>
      </div>
    </div>
  );
}
