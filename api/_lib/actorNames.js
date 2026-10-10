import { serviceClientFor } from "./tenantAuth.js";

// Server finance actions record the caller's auth user id as countedBy,
// verifiedBy, lockedBy, ... These helpers resolve those ids to names using ONLY
// the members of the one business the request is already authorized for.

const text = (value) => String(value ?? "").trim();

// Auth user id -> email / role / driver link, for members of this business only.
export const loadBusinessActors = async (authorization) => {
  const service = serviceClientFor(authorization);
  const { data: members, error } = await service
    .from("business_memberships")
    .select("user_id, role, driver_staff_id")
    .eq("business_id", authorization.businessId);
  if (error) return [];
  const actors = [];
  for (const member of members ?? []) {
    const { data } = await service.auth.admin.getUserById(member.user_id);
    actors.push({
      userId: member.user_id,
      email: text(data?.user?.email).toLowerCase(),
      role: member.role,
      driverStaffId: text(member.driver_staff_id) || null,
    });
  }
  return actors;
};

// Tags the matching directory entries with authUserId (so existing resolvers,
// e.g. the daily report, can name server-recorded actors) and returns an
// id -> display name map. Names never fall back to an email address.
export const annotateActors = (snapshot, actors) => {
  const users = Array.isArray(snapshot?.appUsers) ? snapshot.appUsers : [];
  const drivers = Array.isArray(snapshot?.drivers) ? snapshot.drivers : [];
  const byEmail = new Map(actors.filter((actor) => actor.email).map((actor) => [actor.email, actor]));
  const appUsers = users.map((user) => {
    const actor = byEmail.get(text(user?.email).toLowerCase());
    return actor ? { ...user, authUserId: actor.userId } : user;
  });
  const names = {};
  for (const actor of actors) {
    const fromUsers = users.find((user) => text(user?.email).toLowerCase() === actor.email)?.name;
    const fromDrivers = actor.driverStaffId ? drivers.find((driver) => text(driver?.staffId) === actor.driverStaffId)?.name : null;
    names[actor.userId] = [fromUsers, fromDrivers].map(text).find((name) => name && !name.includes("@")) || actor.role;
  }
  return { snapshot: { ...snapshot, appUsers }, names };
};
