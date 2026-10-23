# Design system and branding

The portal follows an Apple-style, enterprise look: neutral surfaces, hairline borders, the platform font, one brand accent used sparingly, and quick, quiet motion. Guidance came from Emil Kowalski's design-engineering principles and Apple's interface guidelines.

## Tokens

- **`src/styles/tokens.css`** holds every semantic token (surfaces, fills, borders, text, ink, status marks, type scale, spacing, radii, shadows, motion). Colors are written once with `light-dark()`, so the portal follows the device's light or dark setting.
- **`src/styles/brand.css`** holds the brand: the accent blues from thehernandezsolutions.com (`#2b59d9` light, `#6b95ff` dark), the focus ring and the private-note tint.
- Components only use semantic names (`--color-surface`, `--color-accent`, …), never raw colors.

## Principles

- **Color:** primary buttons are ink (near-black in light, near-white in dark), not color. The accent marks links, focus, the selected navigation item, counts and charts. Status (open, in progress, resolved, SLA missed…) shows as a small colored icon inside a neutral chip, always with a text label.
- **Type:** the system font (SF on Apple devices, Segoe UI Variable on Windows). Letter-spacing tightens as text grows (`--tracking-display` for headings, slightly open for small text). Numbers use tabular figures.
- **Layout:** desktop gets a grouped sidebar (like Mail or System Settings); phones and tablets under 1024px get a translucent top bar with a menu sheet. Lists are single grouped surfaces with hairline separators.
- **Appearance:** Settings → Appearance offers Automatic, Light or Dark. The choice is stored in the `itc-theme` cookie and rendered by the server, so there's no flash. Printing is always light.

## Accessibility

- Text contrast meets WCAG AA in both themes (muted text 5.4:1 or better; accent 5.5:1 or better on its backgrounds).
- Links keep a soft underline so they never rely on color alone.
- Touch devices get 44px targets; inputs are 16px there so iOS doesn't zoom.
- `prefers-reduced-motion`, `prefers-reduced-transparency` (solid top bar) and `prefers-contrast: more` (stronger borders and muted text) are honored.

## Motion

- Things people see dozens of times a day don't animate: lists, stats, navigation highlights.
- Page changes are a quick crossfade with a 10px nudge in the direction of travel (about 200ms), not a slide. A ticket's title morphs from the list into the detail heading.
- Occasional surfaces (menu sheet, toasts, sign-in card) use short ease-out entrances under 300ms with strong custom curves (`--ease-out`).
- Buttons and rows give press feedback (`scale(0.97)`); hover effects only apply on devices with a mouse.

## Logo

`public/icon.svg` is a vector redraw of the Hernandez Solutions mark (from `crm/public/brand/logo.png`); `public/apple-touch-icon.png` is the CRM's touch icon.
