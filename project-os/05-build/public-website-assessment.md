# Public website prototype: assessment (2026-10-18; read-only; no code changed)

**Source:** export at `C:\Users\appri\TaxiFlow-Public-Website-Source\TaxiFlow-Public-Website-Source`.
- Published version 3, source commit `255533dbdecae2609d86120c73b9fb38eb6775dd`, exported 2026-10-18.
- The original export was not modified. All inspection used a scratch copy.

## What it is
A **buildless public marketing site**: `dist/index.html`, `styles.css`, `app.js`, local Poppins and images. One page:
- masthead;
- sample operations board with tabs;
- four-step cash-up walkthrough (`pending → counted → verified → banked`, R100 difference kept);
- product stories, roles, getting started, FAQ and footer;
- a walkthrough planner that only downloads a text brief (no backend, no data collected).

It is **not** a redesign of the operations app. It has **no Login control and no screen design for sign-in or the app.**

## Checks on the copy
- `node --check dist/app.js` passes; its own `node --test tests/prototype.test.cjs` passes 5/5.
- Served locally:
  - all 9 requests return 200 (HTML, CSS, JS, 4 fonts, 2 images);
  - no console errors from the site;
  - it renders at 1440×900 and 375×812, with no horizontal scroll at 375 px.
- **Assets:** every referenced file is present: favicon, 4 Poppins weights, rank image (WebP plus PNG source), brand board (WebP plus PNG), brand PNG. **No missing assets.**

## Constraint found
The operations app owns the root of `taxiflow.co.za`:
- the Vercel SPA rewrite;
- PWA `start_url` and `scope` `/`;
- service worker `/sw.js`;
- password-setup and recovery links return to the origin root.

Replacing `/` with the website would move the app. That would affect installed PWAs, the service worker, the Supabase redirect allow-list and email links. **Not recommended.**

## Smallest implementation scope (preserves the layout and the backend)
1. **Keep the site exactly as exported.** Add only a **"Log in" link** in the header (desktop and mobile menu) and the footer, reusing its existing `button small outline-white` and `text-link` styles.
2. **The link goes to the existing app sign-in** (`https://taxiflow.co.za/`). Do not embed a sign-in form in the static site; the app keeps Supabase Auth, memberships and recovery unchanged.
3. **Host the site separately from the app root,** in one of two ways (decision needed):
   - **(a) Recommended:** its own static Vercel project on a subdomain, e.g. `www.taxiflow.co.za`. Today `www` redirects 308 to the apex, so that redirect would be replaced. The app stays at the apex.
   - **(b)** A path in the app project (e.g. `/welcome/`), with SPA-rewrite and service-worker exclusions. That touches the app's routing, so it is a larger regression surface.
4. **Tests:**
   - its 5 Node tests;
   - a link test (Log in resolves to the app sign-in);
   - Playwright smoke at desktop and 375 px;
   - for (b) only, app regression on routing and the service worker.

## Missing inputs (from Tebogo; the export's README lists most of them)
- **Hosting choice** (a or b) and the exact public URL; whether `www` stops redirecting.
- **Login placement approval:** the prototype has no Login control.
- **Pre-launch content:**
  - remove or keep the "Website concept · Sample data" strip and the "Website prototype" footer;
  - final commercial and pricing wording;
  - privacy information;
  - a real enquiry destination (keep the planner local-only until one exists; no fake confirmation).
- Optional: independent production logo files (it currently shows a viewport onto the brand board, which renders correctly).

## Estimate (AI execution; excluding waits)
- **(a)** About 1.5–2.5 h: add the Login link, a repo folder, a static project config, tests, and a Preview.
  - External: DNS/Vercel domain change for `www` (minutes to hours to propagate).
  - Tebogo: choice, approval, and authorizing the domain change.
- **(b)** About 3–5 h plus full app regression (routing, service worker, PWA, recovery redirects).
- Neither touches the database, Auth or finance.
