# Public marketing website: www.taxiflow.co.za (Preview built; domain NOT assigned)

Status 2026-10-18. Branch `agent/public-website` (from `origin/main`).

## Target arrangement
| Host | Serves | Change |
|---|---|---|
| `taxiflow.co.za` | operations app (Vercel project `taxiflowpro`) | **none** |
| `www.taxiflow.co.za` | public website (new Vercel project `taxiflow-website`, `prj_5NPON8FwMjhx3fWPP0BkiwfbWIhy`) | after visual approval only |

## Source
- `website/` is a byte-identical copy of the approved export (version 3, source `255533d`), commit `30636b5`, checked by SHA-256 against `C:\Users\appri\TaxiFlow-Public-Website-Source` (untouched).
- The root `.gitignore` ignored every `dist/`, so `!website/dist/` was added; for this buildless site, `dist/` is the source.
- Changes, in commit `c55b990`:
  - **Log in** (`https://taxiflow.co.za`) is the last main-navigation link, with a gold outline matching the site's 4 px borders. Because it is inside the same `<nav>`, it is also in the mobile menu.
  - The approved design collapses the navigation into the menu at ≤1100 px, so between phone width and 1100 px Log in is in the menu, like every nav link.
  - `vercel.json`: static `dist/`, no build or install.
  - Tests: `public-site.test.cjs` (Log in target, every link and button, planner honesty) and `smoke.mjs` (browser).
  - `prototype.test.cjs`: the local-asset check skips absolute `https://` links (one condition).

## CTA audit
| CTA | Destination or behaviour | Verified |
|---|---|---|
| Logo (header and footer), "Back to top" | `#` (top of page) | yes |
| Nav: The platform, How it works, Your team, Questions | `#operations`, `#cash-flow`, `#team`, `#questions` | yes (targets exist) |
| **Log in** (nav and mobile menu) | `https://taxiflow.co.za`, the app sign-in | yes; on the Preview it lands on Sign in + Forgot password |
| "Take a look at the day", explore dock, module dock, story links | in-page fragments (9 distinct targets) | yes |
| Sample board tabs; "See this cash-up"; "Explore the sample fleet view"; walkthrough steps / Next | select a sample and scroll to it (local only) | yes |
| FAQ disclosures | native `<details>` | yes |
| **"Arrange a walkthrough" (header and footer) / "Prepare a walkthrough"** | opens the planner dialog, which **only downloads a text brief** | **FLAG:** it does not persist or send enquiries and notifies nobody. It says so honestly ("No enquiry has been sent", "No enquiry was sent"); no false success message. A real enquiry destination is needed before it can capture leads. |

## Evidence
- **Local:** `node --check` passes; `node --test website/tests/` passes 9/9 (the export's 5 plus 4 new); `node website/tests/smoke.mjs` passes 30/30. At 1440×900 and 375×812:
  - fonts and images load, with no failed requests or console errors and no horizontal scroll;
  - Log in is visible on desktop, and in the mobile menu as a 293×51 tap target;
  - all in-page targets exist;
  - the planner downloads the brief and shows honest messages;
  - the tabs and the walkthrough work.
- **App:** `npm run build` passes; no app file was changed.
- **Preview** `https://taxiflow-website-dt6j6b4zd-apprigate.vercel.app` (protected by Vercel Authentication). Checked in the browser:
  - all 8 site requests return 200; 4 Poppins weights load;
  - 1440 px: Log in visible in gold; 375 px: menu shows Log in, no overflow;
  - clicking Log in reaches `https://taxiflow.co.za/` sign-in; the app's service worker is still `https://taxiflow.co.za/sw.js`.

## Incident during the Preview deploy (fixed)
The first CLI deploy of the new project was recorded as that project's *Production* deployment (`p29sq1g3e`). It received a **public** alias, `taxiflow-website.vercel.app`.
- **Fix:** the alias was removed (now 404); the deployment URL itself stays protected (302).
- No custom domain was involved.
- The project has `autoAssignCustomDomains: true`, so any later `--prod` deploy would re-add the `.vercel.app` alias. Only deploy `--prod` at go-live.

## www conflict (before any domain change)
- `www.taxiflow.co.za` is attached to `taxiflowpro` as a 308 redirect to `taxiflow.co.za`; that redirect must be removed there.
- **DNS:** `www` is a CNAME to `a1963e84e6a53d28.vercel-dns-017.com` (Vercel, same team), so **no DNS change** is expected; Vercel will confirm when the domain is added.
- Auth is unaffected: the Supabase Site URL and redirects are apex-only.
- Any old `www` bookmark lands on the website, where Log in leads to the app.

## Go-live steps (after visual approval; authorization needed)
1. `vercel deploy --prod` from `website/` (project `taxiflow-website`).
2. Remove `www.taxiflow.co.za` from `taxiflowpro` (its redirect).
3. Add `www.taxiflow.co.za` to `taxiflow-website` and follow Vercel's verification.
4. Check:
   - `https://www.taxiflow.co.za` shows the website over HTTPS;
   - `http://www` redirects 308 to `https://www`;
   - `https://taxiflow.co.za` is the unchanged app (sign-in, recovery, service worker);
   - Log in leads to the app.

**Rollback:** remove www from `taxiflow-website` and re-add it to `taxiflowpro` with a 308 redirect to `taxiflow.co.za`.

## Open content decisions (from the export's README; not changed)
- the "Website concept · Sample data" strip and the "Website prototype" footer text;
- pricing wording, privacy information;
- the enquiry destination (see the CTA flag);
- independent logo files (optional).
