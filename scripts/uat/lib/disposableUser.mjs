import { createUser, deleteUser } from "../../../api/_lib/userLifecycle.js";
import { resolveServerWorkspaceKey } from "../../../api/_lib/workspaceKey.js";

// Provisions/tears down a throwaway UAT account through the SAME server-orchestrated
// lifecycle functions api/admin/auth-users.js calls in production (createUser /
// deleteUser from api/_lib/userLifecycle.js) - not a parallel, UAT-only
// implementation. requesterEmail must already be an active Owner in the live
// appUsers directory (the real UAT_OWNER_EMAIL), exactly as the HTTP endpoint
// requires via requireActiveOwner.

const WORKSPACE_KEY = resolveServerWorkspaceKey();

export const buildDisposableUatEmail = ({ runId, domain }) =>
  `taxiflow-uat+${runId}@${domain}`;

export const provisionDisposableUser = async ({
  supabase,
  ownerEmail,
  email,
  password,
  role = "Manager",
}) => {
  const result = await createUser({
    supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: ownerEmail,
    email,
    name: `TaxiFlow UAT (${new Date().toISOString()})`,
    role,
    password,
    staffId: null,
  });

  if (!result.ok) {
    throw new Error(`Failed to provision disposable UAT user: ${result.error}`);
  }

  return result;
};

export const cleanupDisposableUser = async ({ supabase, ownerEmail, email }) => {
  const result = await deleteUser({
    supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: ownerEmail,
    email,
  });

  return result;
};
