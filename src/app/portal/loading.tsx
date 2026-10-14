export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="skeleton line" />
      <div className="skeleton line" />
      <div className="grid grid-stats">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton block" />
        ))}
      </div>
      <div className="stack">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton block" />
        ))}
      </div>
    </div>
  );
}
