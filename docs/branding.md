# Branding and theme tokens

## Current state

- The palette in `src/styles/brand.css` is copied from the live thehernandezsolutions.com theme variables (`--bg`, `--bg-elev`, `--surface`, `--surface-2`, `--fg`, `--fg-muted`, `--accent`, `--accent-2`, `--line`), for both its dark (default) and light themes, as supplied by the owner on 2026-10-10.
- Hover, soft and strong-border variants are `color-mix()` blends of those values; no new hues were added.
- The website defines no success/warning/danger colors, so those stay neutral. Fonts still use the system UI stack until the website's font is known.
- Measured contrast (WCAG): text on background 18.4:1 dark / 17.8:1 light; muted text on raised surfaces 7.9:1 / 7.3:1; accent on surface 6.8:1 / 5.1:1; button text on accent 7.1:1 / 5.9:1.

## Applying the Hernandez Solutions brand

All components use semantic tokens defined in `src/styles/tokens.css`. To brand the portal, set values in **`src/styles/brand.css`** only:

```css
:root {
  --color-accent: …;          /* primary buttons, active nav underline, focus accents */
  --color-accent-hover: …;
  --color-accent-contrast: …; /* text on the accent */
  --color-accent-soft: …;     /* translucent accent for hovers/selected states */
  --color-link: …;
  --color-focus: …;
  --color-success: …; --color-warning: …; --color-danger: …; --color-info: …;
  --font-sans: …; --font-display: …;
}
```

If the website uses web fonts, self-host them under `public/fonts` and add `@font-face` rules in `brand.css` (the CSP allows fonts from the portal's own origin only). Replace `public/icon.svg` with the official logo mark.

## Accessibility rules that stay true after branding

- Status, priority, compliance and sync state always show an icon **and** a text label; color is supplementary. Waiting and non-compliant states also use dashed borders.
- Check contrast after setting colors: body text and `--color-text-muted` ≥ 4.5:1 on `--color-bg` and `--color-surface`; `--color-accent-contrast` on `--color-accent` ≥ 4.5:1; `--color-focus` ≥ 3:1 against adjacent colors. Any WCAG contrast checker works.
- Motion respects `prefers-reduced-motion`.

## Motion

- Route changes use React `<ViewTransition>`: forward navigation slides content in from the right, "back" links slide it the other way, other changes cross-fade. The header stays anchored.
- A ticket's title morphs from the list row into the detail heading.
- List rows rise in with a short stagger; stats fade up; skeletons shimmer while loading; inline errors shake once; toasts slide in.
- All of it is disabled under `prefers-reduced-motion: reduce`, and browsers without View Transitions simply navigate normally.
