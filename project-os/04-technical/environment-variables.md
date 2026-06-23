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

## Deployment Platform Variables
Document variables required by Vercel, Firebase, Netlify, Railway, Render, Supabase, or other platforms.

## Common Risks
- Missing variable in production
- Wrong variable prefix
- Secret pasted with broken line breaks
- Client trying to access server-only variable
- Server trying to access browser-only variable
