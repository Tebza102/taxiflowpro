import { useCallback, useEffect, useState } from "react";

import { MEMBER_PERMISSIONS, PERMISSION_ROLES, defaultPermissionsForRole, delegablePermissions, normalizePermissionList } from "../lib/memberPermissions";
import { membersRequest } from "../lib/tenantWorkspace";

// Tenant mode Settings: business access through POST /api/business/members.
// Owners grant Admin, Manager and Driver access, remove or restore it, set each
// Admin's and Manager's responsibilities, keep driver profiles (no sign-in
// needed) and link their own login to a profile. Admins can view. Owners
// themselves are created by the operator procedure. Roles and sign-ins stay
// with the Owner. Responsibilities can also be changed by someone the Owner gave
// "Manage staff responsibilities", only within what that person holds (the
// server enforces it; these controls only reflect it).
const ROLES = ["Admin", "Manager", "Driver"];
const emptyGrant = { email: "", name: "", role: "Admin", driverStaffId: "" };
const MODULE_LABELS = { finance: "Money", fleet: "Fleet & Operations", drivers: "Drivers", settings: "Settings" };

const storedPermissions = (member) =>
  member.permissions === null || member.permissions === undefined ? defaultPermissionsForRole(member.role) : normalizePermissionList(member.permissions);

function ResponsibilityEditor({ member, isOwner, delegable, isSelf, busy, onSave }) {
  const stored = storedPermissions(member);
  const [draft, setDraft] = useState(stored);
  const storedKey = stored.join(",");
  useEffect(() => {
    setDraft(storedKey ? storedKey.split(",") : []);
  }, [storedKey]);
  const changed = [...draft].sort().join(",") !== [...stored].sort().join(",");
  // Owner: any. Staff manager: only what it holds, never itself, never another staff manager.
  const canEditMember = !isSelf && member.active && (isOwner || (delegable.length > 0 && !stored.includes("staff.manage")));
  const canEditKey = (key) => canEditMember && (isOwner || delegable.includes(key));
  return (
    <div className="tenant-responsibilities" data-testid="responsibilities">
      <p className="eyebrow">Responsibilities</p>
      {MEMBER_PERMISSIONS.map((permission) => {
        const moduleOff = member.moduleAccess?.[permission.module] === false;
        return (
          <label key={permission.key} className="finance-field finance-field-check" title={permission.detail}>
            <span>
              {permission.label}
              {moduleOff ? ` (inactive: ${MODULE_LABELS[permission.module]} is switched off for this person)` : ""}
            </span>
            <input
              type="checkbox"
              aria-label={`${permission.label} for ${member.email}`}
              disabled={!canEditKey(permission.key) || busy}
              checked={draft.includes(permission.key)}
              onChange={(event) =>
                setDraft((current) => (event.target.checked ? [...current, permission.key] : current.filter((key) => key !== permission.key)))
              }
            />
          </label>
        );
      })}
      {canEditMember && (
        <button type="button" className="record-button" disabled={busy || !changed} onClick={() => onSave(draft)}>
          Save responsibilities
        </button>
      )}
    </div>
  );
}

export default function TenantAccessPanel({ activeRole, currentUserEmail, actorPermissions = [], onChanged }) {
  const isOwner = activeRole === "Owner";
  const delegable = delegablePermissions({ role: activeRole, permissions: actorPermissions });
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
              <h3>{member.name}</h3>
              <p className="tenant-access-detail">
                {member.email} / {member.role}
                {member.driverStaffId ? ` / driver profile ${member.driverStaffId}` : ""}
                {member.active ? "" : " / access removed"}
              </p>
              {PERMISSION_ROLES.includes(member.role) && (
                <ResponsibilityEditor
                  member={member}
                  isOwner={isOwner}
                  delegable={delegable}
                  isSelf={member.email === String(currentUserEmail ?? "").toLowerCase()}
                  busy={busy}
                  onSave={(permissions) =>
                    run("member.permissions", { userId: member.userId, permissions }, `Responsibilities saved for ${member.email}. They apply from their next action.`)
                  }
                />
              )}
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
        <p className="finance-form-note" data-tone="info">
          Only the Owner changes roles and sign-ins. Responsibilities: the Owner, or someone given "Manage staff responsibilities" (only ones they hold, never their own, never another staff manager's). A responsibility works only while its module is switched on for that person.
          Not available here yet: changing someone&apos;s role (remove access and grant it again) and custom roles.
        </p>
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
                <h3>{profile.name}</h3>
                <p>{profile.signInLinked ? "Has a sign-in" : "No sign-in"}</p>
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
