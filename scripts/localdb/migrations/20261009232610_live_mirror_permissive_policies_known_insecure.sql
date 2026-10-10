-- KNOWN INSECURE — mirrors the live policies so the unchanged app can run locally.
--
-- Live (read-only inventory, 2026-10-09) lets ANY authenticated user read, insert
-- and update the whole workspace snapshot (using/with check = true). That is not
-- acceptable for the pilot: there is no membership, role or tenant check, so a
-- Driver can read finance data and overwrite everything. It is kept here, in its
-- own clearly named migration, only so local tests reproduce live behaviour. The
-- tenant/role isolation work must replace this file, not build on it.
-- scripts/localdb/verify.mjs reports these policies as a WARN finding.
create policy "LIVE MIRROR (insecure): authenticated read"
  on public.workspace_snapshots for select to authenticated
  using (true);

create policy "LIVE MIRROR (insecure): authenticated insert"
  on public.workspace_snapshots for insert to authenticated
  with check (true);

create policy "LIVE MIRROR (insecure): authenticated update"
  on public.workspace_snapshots for update to authenticated
  using (true) with check (true);
