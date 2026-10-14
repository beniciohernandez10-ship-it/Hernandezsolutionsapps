"use client";

export default function PortalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="alert alert-danger" role="alert">
      <div>
        <strong>Something went wrong loading this page.</strong>
        <p>Your data is safe. Try again, and if it keeps happening contact Hernandez Solutions.</p>
        <button className="btn" onClick={() => reset()}>Try again</button>
      </div>
    </div>
  );
}
