# Run TaxiFlow Pro locally

This ZIP contains the actual existing source for:
https://taxiflow-pro-operations.divine-tune-4772.chatgpt.site

Published version: 3
Source commit: 255533dbdecae2609d86120c73b9fb38eb6775dd
Exported: 18 October 2026

## Start

1. Extract the ZIP and open its folder in VS Code.
2. With Python 3 installed, run from that folder:

```sh
python -m http.server 8000 --directory dist --bind 127.0.0.1
```

On Windows, use `py -m http.server 8000 --directory dist --bind 127.0.0.1` if needed.
3. Open http://localhost:8000 in your browser. Stop with Ctrl+C.

Alternatively, use VS Code Live Server on `dist/index.html`.

## Source and checks

- `dist/index.html`: page markup, inline SVG components and icons.
- `dist/styles.css`: styles and local font-loading declarations.
- `dist/app.js`: interactions.
- `dist/assets/`: supplied images, favicon and Poppins TTF fonts.
- `tests/prototype.test.cjs`: existing Node tests.
- `.openai/hosting.json`: original static-hosting configuration; not required for local serving.

This is a buildless site. No npm install, build, package.json, lockfile, credentials or environment variables are required.
Optional checks with Node.js: `node --check dist/app.js` and `node --test tests/prototype.test.cjs`.
The enquiry planner runs locally and downloads a brief; it does not submit leads to a backend.

All original tracked files are included without changes except this README, which has these export/run instructions prepended. No site source was committed, pushed or deployed during export. Git history and credential-bearing checkout metadata are excluded.

---

## Original project README

# TaxiFlow Pro public website prototype

Buildless HTML, CSS and JavaScript. Static output is in `dist/`.

## Visual direction

This revision follows the user-supplied Prague Airport screenshot and HTML as a reference for composition: full-width photographic masthead, navigation on the image, an overlapping exploration dock, an operational information board, alternating product stories and a useful grouped footer. It does not copy the airport's content, photos, tracking scripts, Drupal implementation or customer functionality.

The JB Motors public HTML/CSS was fetched and reviewed. The earlier prototype's warm canvas, compact dashboard hero and general editorial treatment were replaced with an image-led public product site. The source reference uses a warm #E28E56 accent and Geist typography; TaxiFlow Pro uses its own approved golden yellow, green and Poppins.

Brand source: user attachment image(7).png. Palette: charcoal #17232D, golden yellow #FFB600, green #08784A and light neutral #F8F9F8. Local Poppins weights 400, 500, 600 and 700 are bundled. The approved horizontal logo is displayed using an inline SVG viewport onto the brand board on a solid white plaque. This preserves its artwork and provides consistent contrast over photos, light surfaces and dark surfaces. The favicon uses the approved app-icon area through an embedded SVG viewport. No substitute TF logo is used.

## Behaviour and boundaries

All finance, vehicle, driver, route and phone-interface examples are illustrative. The walkthrough preserves pending | counted | verified | banked. The R100 difference remains visible through verification and banking. The public prototype does not touch production finance, authentication, database or PWA code.

The site has sample cash-up/fleet tabs, a four-stage cash-up walkthrough, contextual links that select the relevant sample, FAQ disclosures, mobile navigation and a walkthrough brief planner. Keyboard navigation is implemented for both tab sets. Native dialogs manage focus for the planner. Reduced-motion preferences are respected. The wide example table scrolls horizontally on small screens.

The planner downloads a text brief on the visitor's device. It sends no request and collects no contact information. Approved contact destinations, lead storage and notifications are required before making it a live enquiry form. Do not display a fake submission confirmation.

Before external launch: approved independent production logo files, verified contact/enquiry routing, final commercial terms, privacy information and a verified operational-app login URL. Confirm final product claims and device readiness. Preserve the current private review audience until the owner requests a change.

## Image asset

The rank scene is generated editorial imagery, not a customer fleet photograph. Project asset: dist/assets/taxi-rank-editorial.webp. Created with the built-in image-generation tool, then encoded as WebP for transfer size. The source PNG remains in the assets directory.

Prompt: Photorealistic editorial photograph of a South African township taxi rank in Gauteng at the start of the working day; four parked white commuter minibuses with yellow side markings, two adult Black South African taxi drivers beside the right-most vehicle, vehicles mainly in the right two-thirds with quieter space on the left for white website text. Natural morning light, muted charcoal shadows, restrained golden light, believable modest rank buildings and pavement. No commercial badges, association branding, close-up number plates, overlay text, motion effects or fantasy architecture. Wide 16:9 landscape, eye level. Image only, not a website mockup.

## Verification

node --check dist/app.js and node --test tests/prototype.test.cjs pass. Five checks cover sample cash reconciliation, workflow statuses and retained variance, asset/fragment/ARIA target resolution, explicit local-only enquiry disclosure, and contextual sample selection/focus. CSS block balance and palette/font declarations were also checked.

Browser and physical-phone visual QA remain outstanding. The required control-browser capability is unavailable in this environment, so no browser QA or Playwright execution is claimed.

## Readability and motion revision

Public body copy is generally 16px, with readable navigation and controls, 14–15px table values and larger supporting labels. Mobile layouts stack financial summaries and product stories to accommodate the larger text. Header navigation collapses before the enlarged links would crowd the logo.

One-time hero entrances, scroll reveals, hover feedback and 240ms example transitions are added. Scroll reveals only activate when IntersectionObserver exists; content stays visible otherwise. Reduced-motion preferences disable entrances, reveals and example animation.
