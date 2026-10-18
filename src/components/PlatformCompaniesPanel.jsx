import { useCallback, useEffect, useState } from "react";

import { createPlatformCompany, loadPlatformCompanies } from "../lib/tenantWorkspace";

// Platform admin console: companies (metadata only) and onboarding a new
// company with its initial Owner. The server decides access (operator-granted
// platform admin) and never returns company data here. The Owner receives a
// password-setup email; nobody else chooses or sees their password. Repeating
// the same details is safe (the server treats it as the same company).
const emptyDraft = { name: "", slug: "", ownerName: "", ownerEmail: "", ownerDrives: false };

const slugFromName = (name) =>
  String(name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");

export default function PlatformCompaniesPanel({ email, onBack, onSignOut }) {
  const [companies, setCompanies] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [slugEdited, setSlugEdited] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await loadPlatformCompanies();
    if (result.ok) setCompanies(result.companies);
    else setFeedback({ tone: "danger", message: result.error });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (key, value) =>
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if (key === "name" && !slugEdited) next.slug = slugFromName(value);
      return next;
    });

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    const result = await createPlatformCompany({
      name: draft.name.trim(),
      slug: draft.slug.trim(),
      ownerName: draft.ownerName.trim(),
      ownerEmail: draft.ownerEmail.trim(),
      ownerDrives: draft.ownerDrives,
    });
    setBusy(false);
    if (!result.ok) {
      setFeedback({ tone: "danger", message: result.error });
      return;
    }
    const ownerNote =
      result.ownerAccount === "new"
        ? result.setupEmailSent
          ? `A password-setup email was sent to ${draft.ownerEmail.trim()}.`
          : `The setup email could not be sent; ask the Owner to use "Forgot password?" with ${draft.ownerEmail.trim()}.`
        : `${draft.ownerEmail.trim()} already has a TaxiFlow sign-in and keeps their password; they choose this company after signing in.`;
    setFeedback({
      tone: "success",
      message:
        result.status === "existing"
          ? `${draft.name.trim()} already exists with this Owner. Nothing was changed.`
          : `${draft.name.trim()} created. ${ownerNote}`,
    });
    setDraft(emptyDraft);
    setSlugEdited(false);
    await load();
  };

  return (
    <div className="auth-shell">
      <div className="auth-card platform-card" data-testid="platform-console">
        <div className="brand-lockup auth-brand">
          <img className="brand-logo auth-logo" src="/brand/taxiflow-logo.png" alt="TaxiFlow Pro" />
        </div>
        <div className="auth-copy">
          <p className="eyebrow">Platform admin</p>
          <h1>Companies</h1>
          <p>
            Signed in as {email}. Create a company and invite its Owner. You do not get access to a
            company&apos;s data from here; its Owner adds their own Admins, Managers and Drivers.
          </p>
        </div>

        {feedback && (
          <div className="finance-feedback" data-tone={feedback.tone} role="status">
            {feedback.message}
          </div>
        )}

        <div className="platform-company-list" data-testid="platform-companies">
          {companies === null ? (
            <p>Loading companies…</p>
          ) : (
            companies.map((company) => (
              <div key={company.businessId} className="platform-company-row" data-testid="platform-company-row">
                <strong>
                  Tenant {company.tenantNumber}: {company.name}
                </strong>
                <span>
                  {company.slug} · Owner {company.owners.length ? company.owners.join(", ") : "none"} ·{" "}
                  {company.activeMembers} active {company.activeMembers === 1 ? "member" : "members"}
                </span>
              </div>
            ))
          )}
        </div>

        <form className="platform-form" onSubmit={submit} data-testid="platform-create-company">
          <h2>New company</h2>
          <label className="finance-field">
            <span>Company name</span>
            <input value={draft.name} onChange={(event) => update("name", event.target.value)} required maxLength={120} />
          </label>
          <label className="finance-field">
            <span>Company id (slug)</span>
            <input
              value={draft.slug}
              onChange={(event) => {
                setSlugEdited(true);
                update("slug", event.target.value.toLowerCase());
              }}
              pattern="[a-z0-9][a-z0-9-]{2,62}"
              title="3-63 lowercase letters, digits or dashes"
              required
            />
          </label>
          <label className="finance-field">
            <span>Owner name</span>
            <input value={draft.ownerName} onChange={(event) => update("ownerName", event.target.value)} maxLength={120} />
          </label>
          <label className="finance-field">
            <span>Owner email</span>
            <input type="email" autoComplete="off" value={draft.ownerEmail} onChange={(event) => update("ownerEmail", event.target.value)} required />
          </label>
          <label className="platform-checkbox">
            <input type="checkbox" checked={draft.ownerDrives} onChange={(event) => update("ownerDrives", event.target.checked)} />
            <span>The Owner also drives</span>
          </label>
          <div className="finance-form-actions">
            <button type="submit" className="action-button primary" disabled={busy}>
              {busy ? "Creating…" : "Create company and invite Owner"}
            </button>
          </div>
        </form>

        <div className="finance-form-actions">
          {onBack && (
            <button type="button" className="action-button" onClick={onBack}>
              Back to my business
            </button>
          )}
          <button type="button" className="action-button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
