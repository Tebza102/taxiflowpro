# TaxiFlow Pro

Mobile-first ERP command centre for the South African minibus taxi industry.

## What is in this build

- A React + Vite front end shaped around the TaxiFlow project report, SOP, and brand palette.
- A seeded operational dashboard covering finance, fleet health, compliance, and driver workflows.
- A Supabase-ready repository boundary that falls back to local demo data until live credentials and tables exist.
- PWA metadata so the app can be installed like a rank-friendly mobile application.

## Run locally

```bash
npm install
npm run dev
```

## Backend notes

- Demo mode stays local and uses the seeded dataset.
- Live mode uses Supabase when valid environment variables exist and an authenticated session is present.
- The current production sync path stores the live workspace in `workspace_snapshots.snapshot` for cross-device sharing.
- `supabase/schema.sql` includes the snapshot sync table plus the normalized ERP tables for the next backend phase.
