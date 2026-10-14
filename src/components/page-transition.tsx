import { ViewTransition } from "react";

/** Directional slide for forward/back navigations; put in each page (layouts persist and never animate). */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition
      enter={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "fade-swap" }}
      exit={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "fade-swap" }}
      default="none"
    >
      <div>{children}</div>
    </ViewTransition>
  );
}
