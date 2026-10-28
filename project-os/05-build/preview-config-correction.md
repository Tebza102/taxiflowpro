# Preview configuration correction (prepared and APPLIED 2026-10-28)

## Result (applied 2026-10-28 ~18:24 UTC, approved by Tebogo)

- The three records `GI8rLthQfc03IvSJ`, `vtTUkEj1aZ8NBahD`, `Wfm4tf0xNpI9a5uy` now target **Production only** (PATCH of `target` only; no value sent or re-entered). All 9 records and ids otherwise unchanged; release-06 overrides unchanged; production server key unchanged.
- Verification Preview: `taxiflowpro-6ngbg58jb-apprigate.vercel.app` (redeploy of `agent/user-guide` `99cf0c6`, inspect id `3BKsLDHzW5GFh2mVnUiZZ3BZWjih`), checked with a temporary bypass:
  - built browser assets (index.html + 8 files): 0 production refs, 0 test refs, 0 `*.supabase.co` URLs, 0 key-like JWTs;
  - server endpoints: unauthenticated 401; with a token 503 (`/api/business/workspace`, `/memberships`, `/finance-actions`, `/api/admin/daily-log/:id/report-view`);
  - browser: "Startup problem: Secure sign-in is unavailable. TaxiFlow live mode requires Supabase authentication. Please contact the system administrator." No sign-in form, no demo data, no request to any host outside vercel.app;
  - production `taxiflow.co.za`: 200, normal Supabase sign-in page (no sign-in attempted).
- Bypass revoked: 0 entries; protection on; Preview 302 without Vercel login.
- Observation (not changed): `taxiflow.apprigate.com`, attached to this project, answers with an "Index of /" page served from elsewhere; unrelated to this change.
- The 18 historical Previews below are **kept behind Vercel login** (Tebogo's decision, option B).

Vercel project `apprigate/taxiflowpro` (`prj_vYaxObYXR8imyMKRr951yLJ0XAh7`). Names, scopes and record ids only; no values were read or printed.

## Current environment variables

| Name | Type | Environments | Git branch | Record id | Created / updated (UTC) |
|---|---|---|---|---|---|
| `VITE_SUPABASE_URL` | sensitive | **Production + Preview** | all | `GI8rLthQfc03IvSJ` | 2026-05-19 / 2026-08-10 |
| `VITE_SUPABASE_ANON_KEY` | encrypted | **Production + Preview** | all | `vtTUkEj1aZ8NBahD` | 2026-10-11 / 2026-10-11 |
| `SUPABASE_URL` | sensitive | **Production + Preview** | all | `Wfm4tf0xNpI9a5uy` | 2026-08-10 / 2026-08-10 |
| `SUPABASE_SERVICE_ROLE_KEY` | sensitive | Production | all | `e8BsHeHhjHJOMlsD` | 2026-08-10 / 2026-10-11 |
| `VITE_BACKEND_MODE` | encrypted | Development + Preview + Production | all | `LaFeYw3yP3YALjwj` | 2026-03-31 |
| `VITE_SUPABASE_URL` | sensitive | Preview | `agent/owner-responsibilities` | `J2b8enUNdkDW2YHL` | 2026-10-19 18:08 |
| `VITE_SUPABASE_ANON_KEY` | sensitive | Preview | `agent/owner-responsibilities` | `D4Rq7RSBtmJCwvgS` | 2026-10-19 18:08 |
| `SUPABASE_URL` | sensitive | Preview | `agent/owner-responsibilities` | `2XQYPD9s9y42xiID` | 2026-10-19 18:08 |
| `SUPABASE_SERVICE_ROLE_KEY` | sensitive | Preview | `agent/owner-responsibilities` | `ZS4jl7t774ixdcHp` | 2026-10-19 20:22 |

## General Preview variables that point to production

The first three rows are single records shared by Production and Preview, so every Preview without a branch override gets production's values (shown by record identity, not by reading values):

- `VITE_SUPABASE_URL`: production project URL, built into the browser bundle.
- `VITE_SUPABASE_ANON_KEY`: production public (anon) key, built into the browser bundle.
- `SUPABASE_URL`: production URL for the server functions.

The production server key (`SUPABASE_SERVICE_ROLE_KEY`) is Production only, so these Previews' server endpoints answer 503 ("configuration incomplete"). The browser bundle can still sign in to production Auth and read what RLS allows a signed-in user (memberships and businesses). Every Preview sits behind Vercel Authentication (`ssoProtection: all_except_custom_domains`; unauthenticated requests get 302); no bypass secret exists (0).

## Proposed change (for approval)

Remove the Preview environment from the three shared production records; change no values.

1. `VITE_SUPABASE_URL` (`GI8rLthQfc03IvSJ`): environments Production + Preview -> **Production**.
2. `VITE_SUPABASE_ANON_KEY` (`vtTUkEj1aZ8NBahD`): Production + Preview -> **Production**.
3. `SUPABASE_URL` (`Wfm4tf0xNpI9a5uy`): Production + Preview -> **Production**.

Unchanged: `SUPABASE_SERVICE_ROLE_KEY` (Production), `VITE_BACKEND_MODE` (no endpoint or key), and all four `agent/owner-responsibilities` Preview overrides (release 06's isolated test project).

Method: `vercel api /v9/projects/taxiflowpro/env/<record id> -X PATCH` with body `{"target":["production"]}` per record (no value in the request). If Vercel refuses to change the environments of a sensitive record without its value, stop and use the dashboard (Settings > Environment Variables > the record > untick Preview) instead; never re-enter or display a value.

Effect:
- Production: same records, same values, still targeted. The live production deployment is not rebuilt and does not change.
- Release 06 Previews: keep their branch overrides (test project).
- Any other branch Preview built afterwards has no Supabase URL or key: the browser cannot reach any Supabase project (the app treats this as no configuration), and every server endpoint answers 503. It cannot connect to production.

Verification after applying:
1. `vercel env ls` shows the three records as Production only; release-06 overrides unchanged; Production list identical in names and ids.
2. Redeploy one non-release-06 branch Preview (e.g. `agent/user-guide` head) and confirm with a temporary bypass (revoked afterwards, back to 0) that its bundle contains neither the production ref `vfxftviwteypasredjgm` nor any Supabase URL, and that `/api/business/workspace` answers 503. (The bypass needs its own approval, as on 2026-10-28.)
3. Production unchanged: `https://taxiflow.co.za` still loads its sign-in page (read-only check; no sign-in).

Rollback: tick Preview again on the same three records (no values involved).

## Existing builds are not changed by this (classification INFERRED from configuration history)

Vercel fixes a deployment's variables at build time. These existing Preview deployments were built with the production values (from the build times against the variables' history above), and keep them until removed:

| Branch | Commit | Deployment | Built (UTC) |
|---|---|---|---|
| agent/driver-salary | 059d12c | taxiflowpro-31gipp51c-apprigate.vercel.app | 2026-10-28 18:02 |
| agent/driver-salary | e46ba96 | taxiflowpro-imd4uouna-apprigate.vercel.app | 2026-10-28 17:18 |
| agent/driver-salary | a8dac17 | taxiflowpro-f6dmkyzcw-apprigate.vercel.app | 2026-10-28 17:18 |
| agent/driver-salary | ea7e571 | taxiflowpro-jkmsyp9q9-apprigate.vercel.app | 2026-10-28 16:29 |
| agent/driver-salary | bd063c5 | taxiflowpro-fzncw10ej-apprigate.vercel.app | 2026-10-28 16:28 |
| agent/user-guide | 99cf0c6 | taxiflowpro-81msiuesc-apprigate.vercel.app | 2026-10-28 16:03 |
| agent/user-guide | 8b7c0cb | taxiflowpro-mwxckqxeo-apprigate.vercel.app | 2026-10-28 16:03 |
| agent/owner-responsibilities | 18fb7c6 | taxiflowpro-k4f7dgqtn-apprigate.vercel.app | 2026-10-19 17:36 (before its overrides at 18:08) |
| agent/owner-responsibilities | 7f1419b | taxiflowpro-nifglxqz9-apprigate.vercel.app | 2026-10-19 17:20 (before its overrides) |
| agent/platform-release-log | 0b02435 | taxiflowpro-htfn3b954-apprigate.vercel.app | 2026-10-18 14:40 |
| agent/platform-release-log | 1561d89 | taxiflowpro-hdno4phh1-apprigate.vercel.app | 2026-10-18 14:37 |
| agent/platform-admin-onboarding | cc39410 | taxiflowpro-e1f865xrg-apprigate.vercel.app | 2026-10-18 13:56 |
| agent/platform-admin-onboarding | 6adf70c | taxiflowpro-n57g8ty1h-apprigate.vercel.app | 2026-10-18 13:50 |
| agent/platform-admin-onboarding | 7d2a9cb | taxiflowpro-i26wlaov8-apprigate.vercel.app | 2026-10-18 12:25 |
| agent/platform-admin-onboarding | 946861d | taxiflowpro-kd3l04xjy-apprigate.vercel.app | 2026-10-18 12:21 |
| agent/public-website | f2ae1c6 | taxiflowpro-21e0adog2-apprigate.vercel.app | 2026-10-18 13:56 |
| agent/public-website | fa732cf | taxiflowpro-94zztcsy9-apprigate.vercel.app | 2026-10-18 13:50 |
| agent/tenant-db-foundation | e59417a | taxiflowpro-301dw9v3b-apprigate.vercel.app | 2026-10-11 08:16 |

18 deployments, **inferred** production-connected from build times against the variables' history (not read from their built files). Decision 2026-10-28: **B, keep them behind Vercel Authentication; do not delete.** Options considered:
- **A. Delete all 18** (recommended): `vercel remove <deployment url> --yes` per row. Their branches stay in Git; a new Preview can be built later and, after the change above, will not connect to production. Note PR #4 (public website) and PR #5 (platform release log) would lose their Preview links in this project; the public website itself is deployed from the separate `taxiflow-website` project and is not affected.
- **B. Keep them** and rely on Vercel Authentication (access restricted to the Vercel team). Lower effort; the production-connected bundles remain.

Not production-connected (built with test overrides; their test project is paused, so they fail closed): release-06 Previews from 2026-10-19 19:07 onward (`d4m2ew2ta` to `cwxvdjad9`, 10 deployments) and the two salary test Previews `nry1tv6fk` and `fcuys737n`.

Inference note: the table is derived from build times against the variables' creation and update times (a branch override wins over the general record). The built files of Git deployments are not readable through the API without opening the deployment; the 2026-10-28 bundle guard confirmed the test project for `nry1tv6fk` and `fcuys737n`.
