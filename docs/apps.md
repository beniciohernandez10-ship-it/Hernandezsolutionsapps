# Desktop and mobile delivery

| Experience | Status | Notes |
| --- | --- | --- |
| Responsive website (browser) | **Implemented** | Full portal on desktop and phone widths; tested at 1366×860 and Pixel 7. Nothing to install. |
| Installed web app (PWA) | **Implemented, not yet tested on devices** | Web app manifest + service worker. Install from Chrome/Edge ("Install app"), Android Chrome ("Add to Home screen"), iOS Safari (Share → Add to Home Screen). Same backend, session and permissions. |
| Native desktop executable | **Planned** | Not built. |
| Native iOS / Android app | **Planned** | Not built. |

A responsive page or PWA is not a native app, and nothing here claims otherwise.

## PWA data handling

The service worker caches only immutable `/_next/static/` build assets. Pages, API responses, tickets and identity data are always fetched from the network and never stored offline. Signing out clears caches and storage (`Clear-Site-Data`) and the client deletes Cache Storage before calling sign-out.

## Native plan (when needed)

Recommended: **Tauri 2** (desktop: Windows/macOS) and **Capacitor** (iOS/Android) as thin shells over the same API, or a React Native app if richer offline/native UI is required.

Requirements carried over from the brief:
- Public client registration (no client secret in any binary). Authorization code + PKCE through the **system browser** (ASWebAuthenticationSession / Custom Tabs / default browser), redirect via a claimed HTTPS link (Universal Links / App Links) rather than a custom scheme where possible.
- A token-based API mode alongside cookies: short-lived access tokens issued by the portal after Entra sign-in, refresh token stored in the OS credential store (Keychain, Android Keystore, Windows Credential Manager), revocable server-side.
- No offline ticket cache unless a design for encryption, retention and logout wipe is approved.
- Push notifications (when added) contain generic text only ("You have an update on a request"); details load after authentication.
- Deep links (`/portal/tickets/{id}`) validated against the signed-in user's access like any request.
- Signing: Apple Developer ID + notarization (macOS), Authenticode certificate (Windows), App Store / Play signing; updates via Tauri updater with signed manifests and store updates for mobile.
- Tests: secure deep links, logout clears credential store, reinstall does not restore a session.
