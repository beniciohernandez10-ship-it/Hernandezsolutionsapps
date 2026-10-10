"use client";
export function PrintButton({ disabled }: { disabled?: boolean }) {
  return (
    <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => window.print()}>
      Print
    </button>
  );
}
