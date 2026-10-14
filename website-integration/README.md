# Website integration snippets (not yet applied)

These snippets add a **Client Portal** link to thehernandezsolutions.com and an optional `/client-portal` redirect. They have **not** been applied: the website repository and Vercel project were not available to inspect. The live site looks like a Next.js app (it serves Next.js metadata routes), but that is unconfirmed, so pick the variant that matches the real code after inspecting it.

Rules:
- Merge into the existing navigation and configuration; do not replace existing routes, redirects, headers or rewrites.
- A plain link: no iframe, no shared cookies, no scripts from the portal on the public site.
- The portal handles its own sign-in; being logged in anywhere on the website does not sign anyone in to the portal.

Files:
- `ClientPortalLink.tsx`: drop-in link component for desktop nav and mobile menu (React/Next.js).
- `nav-snippet.html`: the same for a plain HTML/other-framework site.
- `next.config.redirect.ts`: the redirect entry to merge into an existing `next.config` `redirects()`.
- `vercel.redirect.json`: the same redirect for a `vercel.json`-based site (merge the array entry).
