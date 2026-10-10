import { useCallback, useEffect, useState } from "react";

import { membersRequest } from "../lib/tenantWorkspace";

// Tenant mode Settings: business access through POST /api/business/members.
// Owners grant Admin, Manager and Driver access, remove or restore it, keep
// driver profiles (no sign-in needed) and link their own login to a profile.
// Admins can view. Owners themselves are created by the operator procedure.
const ROLES = ["Admin", "Manager", "Driver"];
const emptyGrant = { email: "", name: "", role: "Admin", driverStaffId: "" };

export default function TenantAccessPanel({ activeRole, currentUserEmail, onChanged }) {
  const isOwner = activeRole === "Owner";
  const [data, setData] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const [grant, setGrant] = useState(emptyGrant);
  const [profileName, setProfileName] = useState("");

  const load = useCallback(async () => {
    const result = await membersRequest();
    if (result.ok) setData(result);
    else setFeedback({ tone: "danger", message: result.error ?? "Business access could not be loaded." });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action, fields, success) => {
    setBusy(true);
    const result = await membersRequest({ action, fields });
    setBusy(false);
    if (!result.ok) {
      setFeedback({ tone: "danger", message: [result.error, result.recovery].filter(Boolean).join(" ") });
      return false;
    }
    setFeedback({ tone: "success", message: typeof success === "function" ? success(result) : success });
    // Every change moves the business version; reload it before the next save.
    await onChanged?.();
    await load();
    return true;
  };

  const self = data?.members.find((member) => member.email === String(currentUserEmail ?? "").toLowerCase());
  const freeProfiles = (data?.driverProfiles ?? []).filter((profile) => !profile.signInLinked);

  return (
    <section className="module-panel" data-testid="tenant-access">
      <article className="overview-board">
        <div className="overview-board-head">
          <p className="eyebrow">Business access</p>
          <h3>People who can sign in</h3>
        </div>
        {feedback && (
          <p className="finance-form-note" data-tone={feedback.tone} role="status">
            {feedback.message}
          </p>
        )}
        {!data && !feedback && <p className="finance-form-note">Loading access...</p>}
        {(data?.members ?? []).map((member) => (
          <article key={member.userId} className="person-row" data-testid="access-row">
            <div>
              <strong>{member.name}</strong>
              <span>
                {member.email} / {member.role}
                {member.driverStaffId ? ` / driver profile ${member.driverStaffId}` : ""}
                {member.active ? "" : " / access removed"}
              </span>
            </div>
            {isOwner && member.role !== "Owner" && (
              <button
                type="button"
                className="record-button"
                disabled={busy}
                onClick={() =>
                  run(
                    member.active ? "member.deactivate" : "member.reactivate",
                    { userId: member.userId },
                    member.active ? `Access removed for ${member.email}.` : `Access restored for ${member.email}.`,
                  )
                }
              >
                {member.active ? "Remove access" : "Restore access"}
              </button>
            )}
          </article>
        ))}
      </article>

      {isOwner && (
        <article className="overview-board">
          <div className="overview-board-head">
            <p className="eyebrow">Grant access</p>
            <h3>Add a person</h3>
          </div>
          <form
            className="finance-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const done = await run(
                "member.grant",
                {
                  email: grant.email,
                  name: grant.name || undefined,
                  role: grant.role,
                  ...(grant.role === "Driver" ? { driverStaffId: grant.driverStaffId } : {}),
                },
                (result) =>
                  result.accountCreated
                    ? `${grant.email} can now sign in as ${grant.role}. A password setup email was ${result.setupEmailSent ? "sent" : "NOT sent; ask them to use Forgot password"}.`
                    : `${grant.email} now has ${grant.role} access with their existing sign-in.`,
              );
              if (done) setGrant(emptyGrant);
            }}
          >
            <div className="finance-form-grid">
              <label className="finance-field">
                <span>Email</span>
                <input type="email" required value={grant.email} onChange={(event) => setGrant({ ...grant, email: event.target.value })} />
              </label>
              <label className="finance-field">
                <span>Name</span>
                <input value={grant.name} onChange={(event) => setGrant({ ...grant, name: event.target.value })} />
              </label>
              <label className="finance-field">
                <span>Access</span>
                <select value={grant.role} onChange={(event) => setGrant({ ...grant, role: event.target.value })}>
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
              {grant.role === "Driver" && (
                <label className="finance-field">
                  <span>Driver profile</span>
                  <select required value={grant.driverStaffId} onChange={(event) => setGrant({ ...grant, driverStaffId: event.target.value })}>
                    <option value="">Choose a profile</option>
                    {freeProfiles.map((profile) => (
                      <option key={profile.staffId} value={profile.staffId}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="finance-form-actions">
              <button type="submit" className="action-button primary" disabled={busy}>
                Grant access
              </button>
            </div>
          </form>
        </article>
      )}

      {isOwner && (
        <article className="overview-board">
          <div className="overview-board-head">
            <p className="eyebrow">Drivers</p>
            <h3>Driver profiles</h3>
          </div>
          {(data?.driverProfiles ?? []).map((profile) => (
            <article key={profile.staffId} className="person-row" data-testid="driver-profile-row">
              <div>
                <strong>{profile.name}</strong>
                <span>{profile.signInLinked ? "Has a sign-in" : "No sign-in"}</span>
              </div>
            </article>
          ))}
          <form
            className="finance-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await run("driver.save_profile", { name: profileName }, `Driver profile ${profileName} added.`)) setProfileName("");
            }}
          >
            <div className="finance-form-grid">
              <label className="finance-field">
                <span>Driver name</span>
                <input required value={profileName} onChange={(event) => setProfileName(event.target.value)} />
              </label>
            </div>
            <div className="finance-form-actions">
              <button type="submit" className="action-button" disabled={busy}>
                Add driver profile
              </button>
            </div>
          </form>
          <label className="finance-field">
            <span>I also drive as</span>
            <select
              aria-label="I also drive as"
              disabled={busy}
              value={self?.driverStaffId ?? ""}
              onChange={(event) =>
                run(
                  "owner.link_driver",
                  { driverStaffId: event.target.value || null },
                  event.target.value ? "Your login is now linked to that driver profile." : "Your driver link was removed.",
                )
              }
            >
              <option value="">I do not drive</option>
              {(data?.driverProfiles ?? [])
                .filter((profile) => !profile.signInLinked || profile.staffId === self?.driverStaffId)
                .map((profile) => (
                  <option key={profile.staffId} value={profile.staffId}>
                    {profile.name}
                  </option>
                ))}
            </select>
          </label>
        </article>
      )}
    </section>
  );
}
