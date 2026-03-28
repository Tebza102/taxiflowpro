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

- `src/lib/dataGateway.js` loads live Supabase tables when valid environment variables exist.
- `supabase/schema.sql` captures the core ERP entities: vehicles, reconciliations, banking events, defects, personnel, and compliance documents.
