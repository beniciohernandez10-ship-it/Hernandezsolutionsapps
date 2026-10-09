# Branding and theme tokens

## Current state

- Only one brand value could be confirmed from thehernandezsolutions.com: the dark background **`#05060a`** (its web app manifest `theme_color` and `background_color`). The site's stylesheets could not be read from the build environment.
- The portal therefore uses a **neutral greyscale theme on `#05060a`**. No accent or status colors were invented.
- Fonts default to the system UI font stack; the website's font is unknown.

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
