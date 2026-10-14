# Website integration

Goal: keep thehernandezsolutions.com as it is, add a **Client Portal** item to its desktop navigation and mobile menu, and optionally make `https://thehernandezsolutions.com/client-portal` redirect to `https://portal.thehernandezsolutions.com`.

## Status

**Not applied.** The website's repository and Vercel project were not accessible from this workspace, so the site was not modified. Ready-to-merge snippets are in [`/website-integration`](../website-integration/).

What's needed to apply it:
1. Add the website repository to the project (Project settings → Repositories) or share its name.
2. Confirm the Vercel team and project that serve thehernandezsolutions.com.

Then the change will be: inspect the framework and nav components, add the link in both menus using the existing classes, merge the redirect into the existing config, open a PR against the website repo, and verify on its Vercel preview before anything reaches production.

## Design rules

- Normal link to the portal origin; no iframe embedding (the portal also sends `frame-ancestors 'none'`).
- The portal's session cookie is host-only (`__Host-` prefix, no `Domain`), so the public website never receives it and website scripts cannot read tickets or tokens.
- A website login (if one ever exists) does not grant portal access; the portal always performs its own Microsoft sign-in and membership check.
- Return path: every portal page links back to `WEBSITE_URL` in the header, mobile menu, footer, sign-in and signed-out pages.
- Both projects deploy independently.

## Verification after applying

- Desktop and mobile menus show *Client Portal*; keyboard focus order is sensible; link opens the portal sign-in.
- `/client-portal` returns a 307/308 to the portal.
- Existing routes and redirects still behave as before (spot-check the nav's other links on the preview).
