# Local Supabase (isolated test database)

Purpose: a disposable local database with synthetic data only, for migration tests, backup/restore drills and safe tooling development. It must never hold live data or live credentials.

**Status (2026-10-10 02:01): running and verified, loopback-only. The synthetic export/restore drill passed, covering schema, Auth and snapshot.**

## How it runs

- Docker Desktop 4.94.0 (per-user, WSL 2, Linux containers). Installer verified by SHA-256 and Authenticode; terms accepted by Tebogo.
- A **Docker Compose** stack, not the Supabase CLI. CLI 2.120.0 publishes ports on all interfaces, and Docker Desktop ignores a network-level 127.0.0.1 default (proved 2026-10-10). Compose uses explicit `127.0.0.1:` mappings.
- Same images the CLI pulled:
  - `postgres:17.11.0.004`
  - `gotrue:v2.197.0`
  - `postgrest:v16.4`
  - `kong:2.8.1`
  - `mailpit:v1.31.3`
- Published ports, and nothing else:

  | Service | Address | Container port |
  |---|---|---|
  | API (Kong) | `127.0.0.1:54321` | 8000 |
  | Postgres | `127.0.0.1:54322` | 5432 |
  | Mail UI | `127.0.0.1:54324` | 8025 |

  SMTP, PostgREST and Auth stay on the internal Compose network.
- Workdir `C:\Users\appri\taxiflow-localdb` (outside the repo):
  - `compose\` holds the generated `.env` (random Postgres password, JWT secret, HS256 anon/service keys), `kong.yml` and the db-init scripts. **Local only; never commit.**
  - `supabase\config.toml` is a deliberately invalid sentinel (`TAXIFLOW_SUPABASE_CLI_DISABLED`), so every Supabase CLI command there fails (`CliConfigParseError`). Merely removing it was not enough: the CLI fell back to defaults.
  - `backups\pre-compose-*` holds the preserved CLI volume archive (SHA-256 recorded) and the old CLI config.
  - `drill\<timestamp>\` holds the encrypted export bundle, manifest and drill report.
- Volumes: `taxiflow_localdb_compose_db` (current) and `supabase_db_taxiflow-localdb` (old CLI volume, preserved).

## Commands (from the TaxiFlow repo)

```
node scripts/localdb/setup.mjs prepare   # files + local secrets (once), CLI sentinel
node scripts/localdb/setup.mjs start     # up; stops itself if any port is beyond loopback
node scripts/localdb/setup.mjs reset     # fresh volume + migrations + synthetic seed
node scripts/localdb/setup.mjs stop      # down, keeping the volume
node scripts/localdb/verify.mjs          # 14 PASS + 1 expected WARN
node scripts/localdb/drill.mjs           # export -> destroy -> restore -> compare
```

Open a new terminal after installing Docker, or put `%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin` on PATH.

## Guards (fail closed; `scripts/localdb/lib/localTarget.mjs`, 14 mock tests)

- **Targets:** API/DB URLs must be 127.0.0.1/localhost on 54321/54322; the live project ref and hosted hosts are refused; `--linked`, `--db-url` and `--project-ref` are refused.
- **Docker:** must be the local context (`desktop-linux`), with no `DOCKER_HOST`.
- **Workdir:** outside the repo, never linked, Compose project `taxiflow-localdb`, CLI sentinel present.
- **Bindings:** published ports must be exactly the three loopback mappings, and Windows listeners for `com.docker.backend`/`wslrelay` must be loopback on those ports. Otherwise the stack is stopped.
- **Marker:** the `taxiflow_local.instance` row must be present before seed, export or restore. Only the Compose volume with the matching project label is ever removed.

## Baseline (`scripts/localdb/migrations`, applied in filename order)

1. `workspace_snapshots`: the only table the code uses, matching the live columns, PK and FK to `auth.users`. Grants are the intended target (no anon access; authenticated select/insert/update only; no TRUNCATE).
2. The `taxiflow_local.instance` marker.
3. **Known insecure** live-mirror `using (true)` policies, isolated so tenant work replaces them. `verify.mjs` reports them as WARN.

Seed (`seed-data.mjs`): 5 example.com Auth users (Owner/Admin/Manager/Driver/Viewer) and a synthetic snapshot with the live 18 top-level keys.

## Drill result (2026-10-10 02:00, synthetic)

- **Schema:** recovered by rebuilding from repo migrations on a brand-new volume. It is not restored from the backup.
- **Snapshot-only restore:** refused by the `updated_by -> auth.users` FK. That proves a snapshot-only backup is an **incomplete** recovery.
- **Auth:** 5 users and 5 identities restored from the export; count and hash match; all 5 synthetic sign-ins work (password hashes restored).
- **Snapshot:** restored after Auth. SHA-256, 18 keys, per-key counts, `updated_at` and `updated_by` all match; the Owner reads the row through the API; anon is denied (42501).
- **Not covered:** Auth sessions, refresh tokens, MFA and audit tables; storage; hosted-project settings (Auth URLs, SMTP, keys); and anything about the live project. A live restore remains **unverified**.
