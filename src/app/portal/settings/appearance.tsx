"use client";
import { useState } from "react";

type Theme = "system" | "light" | "dark";
const OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "Automatic" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Light, dark, or follow the device. Stored in a cookie so the server renders the right theme with no flash. */
export function AppearanceControl({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  function choose(next: Theme) {
    setTheme(next);
    const secure = location.protocol === "https:" ? "; secure" : "";
    if (next === "system") {
      document.cookie = `itc-theme=; path=/; max-age=0; samesite=lax${secure}`;
      delete document.documentElement.dataset.theme;
    } else {
      document.cookie = `itc-theme=${next}; path=/; max-age=31536000; samesite=lax${secure}`;
      document.documentElement.dataset.theme = next;
    }
  }
  return (
    <section className="card stack" aria-labelledby="appearance-h">
      <div>
        <h2 id="appearance-h">Appearance</h2>
        <p className="subtle">Automatic matches your device&apos;s light or dark setting.</p>
      </div>
      <div className="tabs" role="group" aria-label="Appearance">
        {OPTIONS.map((o) => (
          <button key={o.value} type="button" aria-pressed={theme === o.value} onClick={() => choose(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </section>
  );
}
