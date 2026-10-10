import { createHttpError } from "./snapshotLoader.js";

export const REPORT_ALLOWED_ROLES = ["Owner", "Admin", "Manager"];

// requestedBy is resolved server-side from the caller's active business
// membership in the database (see tenantAuth.js), never from the token, the
// browser or snapshot.appUsers. Reports need an allowed role AND the account's
// Money access, which moduleAccess.reports mirrors (the Owner is never restricted).
export const assertReportAccess = ({ source, requestedBy } = {}) => {
  if (!requestedBy) {
    // An unauthenticated demo fixture is only ever permitted outside
    // production - never as a way around the role gate in a live deployment.
    if (source === "mock" && process.env.NODE_ENV !== "production") {
      return;
    }

    throw createHttpError(401, "Sign in is required to access this report.");
  }

  if (!REPORT_ALLOWED_ROLES.includes(requestedBy.role)) {
    throw createHttpError(403, "Your role does not have access to management reports.");
  }

  if (requestedBy.moduleAccess?.reports !== true) {
    throw createHttpError(403, "Money access is turned off for your account, so reports are unavailable.");
  }
};
