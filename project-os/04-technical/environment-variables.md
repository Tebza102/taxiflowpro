# Environment Variables

## Rules
- Never paste secret values into this file.
- Document variable names only.
- Explain where each variable is used.
- Separate browser-safe variables from private server-only variables.

## Client/Public Variables
| Variable Name | Purpose | Required | Notes |
|---|---|---|---|
| EXAMPLE_PUBLIC_KEY | Example only | Yes/No | Browser-safe if applicable |

## Server/Private Variables
| Variable Name | Purpose | Required | Notes |
|---|---|---|---|
| EXAMPLE_SECRET_KEY | Example only | Yes/No | Must not be exposed |
| LOGBOOK_VISION_MODEL | Model id used by `POST /api/logbook/extract` to read logbook photos (`api/_lib/logbookVision.js`) | Only for logbook photo import | Server only. Without it the route answers 503 and nothing else is affected. |
| ANTHROPIC_API_KEY | Key for the vision model call in `api/_lib/logbookVision.js` | Only for logbook photo import | Server only. Never `VITE_`-prefixed, never sent to or accepted from the browser. Set per Vercel environment. |

## Deployment Platform Variables
Document variables required by Vercel, Firebase, Netlify, Railway, Render, Supabase, or other platforms.

## Common Risks
- Missing variable in production
- Wrong variable prefix
- Secret pasted with broken line breaks
- Client trying to access server-only variable
- Server trying to access browser-only variable
