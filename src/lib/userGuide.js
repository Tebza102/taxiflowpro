// "How to use TaxiFlow": the post-login guide. Content is built from what the
// signed-in account can actually see and do (role, visible modules, and in the
// business workspace the Owner-assigned responsibilities), so it never points
// at a screen the account cannot open. Plain JS (no React), so Node tests load it.

import { safeLocalStorageGet, safeLocalStorageSet } from "./browserRuntime.js";

// Bump to show the guide once more to everyone after a meaningful content change.
const USER_GUIDE_STORAGE_PREFIX = "taxiflow-user-guide-v1";

const VIEW_LABELS = {
  overview: "Overview",
  finance: "Money",
  fleet: "Fleet & Operations",
  drivers: "Drivers",
  reports: "Reports",
  settings: "Settings",
};

// Completion is remembered per user and per workspace (business), in this
// browser, like the other per-device preferences.
export const getUserGuideStorageKey = ({ userKey, workspaceKey } = {}) =>
  userKey && workspaceKey ? `${USER_GUIDE_STORAGE_PREFIX}:${userKey}:${workspaceKey}` : null;

export const isUserGuideComplete = (storageKey) =>
  Boolean(storageKey) && safeLocalStorageGet(storageKey) !== null;

export const markUserGuideComplete = (storageKey) =>
  Boolean(storageKey) && safeLocalStorageSet(storageKey, new Date().toISOString());

const step = (id, view, title, body, example = null, actionLabel = null) => ({
  id,
  view,
  title,
  body,
  example,
  actionLabel: view ? actionLabel ?? `Open ${VIEW_LABELS[view]}` : null,
});

const warning = (id, title, what, why, todo) => ({ id, title, what, why, todo });

const buildDriverGuide = ({ views, linkedVehicleCount }) => {
  const steps = [];
  const warnings = [];
  const has = (view) => views.includes(view);

  if (has("drivers")) {
    steps.push(
      step(
        "driver-vehicle",
        "drivers",
        "Check your vehicle",
        "Open Drivers. Your vehicle and route show at the top. If you drive more than one vehicle, tap its registration under Choose active vehicle before you capture anything.",
        null,
        "Open my day",
      ),
      step(
        "driver-trips",
        "drivers",
        "Add your trips",
        "Tap Add daily earnings for your route trips. Use Add extra trip for a once-off hire.",
        "Example: 2 trips, 21 passengers, R 920.",
      ),
      step(
        "driver-expenses",
        "drivers",
        "Add costs you paid",
        "Tap Add daily expense for fuel or other costs on the road, and say if you paid cash.",
        "Example: R 120 fuel paid in cash means you hand in R 120 less.",
      ),
      step(
        "driver-cashup",
        "drivers",
        "Send your day for checking",
        "When your day is done, tap Checking. It sends one hand-in total to the office. Hand over the amount shown as Cash to hand in.",
        "Example: R 920 takings minus R 120 cash fuel = R 800 to hand in.",
      ),
    );
  }

  if (has("fleet")) {
    steps.push(
      step(
        "driver-defects",
        "fleet",
        "Report vehicle problems",
        "Open Fleet & Operations to report a problem, such as a cracked windscreen or worn tyres, so it is fixed before it stops the vehicle.",
        null,
        "Report a problem",
      ),
    );
  }

  if (linkedVehicleCount === 0) {
    warnings.push(
      warning(
        "driver-no-vehicle",
        "No vehicle linked yet",
        "Your account is not linked to a vehicle.",
        "Trips and costs are saved against a vehicle, so the office cannot match your cash without one.",
        "Ask your manager to link you to a vehicle in Drivers, then open the app again.",
      ),
    );
  }

  warnings.push(
    warning(
      "driver-checking-needs-entries",
      "Checking needs a saved trip first",
      "The Checking button stays off until you save at least one trip or expense for the day.",
      "Checking sends your day's total; with nothing saved there is no total to send.",
      "Save your trips and costs first, then tap Checking.",
    ),
  );

  return {
    intro:
      "TaxiFlow keeps your daily trips, takings and road costs in one place. The office uses it to check your cash and keep the vehicle on the road.",
    firstStepId: steps[0]?.id ?? null,
    steps,
    warnings,
  };
};

const describeCashPart = ({ count, verify, bank }) => {
  const parts = [
    count ? "record the cash a driver hands in (count)" : null,
    verify ? "verify someone else's count" : null,
    bank ? "record the bank deposit" : null,
  ].filter(Boolean);

  if (parts.length === 0) {
    return "You can follow each stage, but the Owner has not given you a cash step to do.";
  }

  return `Your part: ${parts.join(", ")}.`;
};

const buildManagementGuide = ({ role, views, cash, tenant }) => {
  const steps = [];
  const warnings = [];
  const has = (view) => views.includes(view);
  const isOwner = role === "Owner";

  if (has("overview")) {
    steps.push(
      step(
        "mgmt-overview",
        "overview",
        "Look at Overview",
        "See today's takings, cash waiting to be checked and open vehicle problems at a glance.",
      ),
    );
  }

  if (tenant.ownerDriver && has("drivers")) {
    steps.push(
      step(
        "mgmt-own-driving",
        "drivers",
        "Capture your own driving",
        "You also drive. Set Capture as to My own driving, add your trips and costs, then tap Send my day checking.",
        null,
        "Open Drivers",
      ),
    );
  }

  if (has("finance")) {
    steps.push(
      step(
        "mgmt-capture",
        "finance",
        "Capture the day",
        "In Money, Daily Earnings, add route trips and extra trips that drivers did not capture themselves.",
        "Example: route trip on JHB 457 GP, 2 trips, R 920.",
        "Open Money",
      ),
      step(
        "mgmt-review",
        "finance",
        "Review, verify and bank the cash",
        `In Money, Banking, cash moves through four stages: the driver sends checking, the hand-in is counted, a second person verifies it, then it is deposited. ${describeCashPart(cash)}`,
        null,
      ),
      step(
        "mgmt-expenses",
        "finance",
        "Record expenses",
        "In Money, Expenses, choose the vehicle, the category and how it was paid. Cash paid out of takings lowers the cash to bank.",
        "Example: R 450 tyre repair on JHB 457 GP, paid in cash.",
      ),
    );
  }

  if (has("fleet")) {
    steps.push(
      step(
        "mgmt-fleet",
        "fleet",
        "Keep the fleet ready",
        tenant.fleetManage
          ? "Fleet & Operations holds vehicles, routes, service dates and reported problems. Mark a problem fixed once it is repaired."
          : "Fleet & Operations shows vehicles, service dates and reported problems. The Owner decides who can edit them.",
      ),
    );
  }

  if (has("drivers")) {
    steps.push(
      step(
        "mgmt-drivers",
        "drivers",
        "Link drivers to vehicles",
        tenant.driversManage
          ? "In Drivers, link each driver to a vehicle so their trips and cash land in the right place."
          : "Drivers shows who is driving which vehicle. The Owner decides who can change the roster.",
      ),
    );
  }

  if (has("reports")) {
    steps.push(
      step(
        "mgmt-reports",
        "reports",
        "Check the reports",
        "Reports gives a printable daily finance report for the day you choose.",
      ),
    );
  }

  if (has("settings")) {
    steps.push(
      step(
        "mgmt-settings",
        "settings",
        isOwner ? "Give your team access" : "See who has access",
        isOwner
          ? "In Settings, add people and choose what each person may do."
          : "Settings shows the people in this business and what each may do.",
      ),
    );
  }

  if (!has("finance") && role !== "Owner") {
    warnings.push(
      warning(
        "mgmt-money-off",
        "Money is switched off for you",
        "Your account cannot open Money or Reports.",
        "Daily takings, expenses and banking all live in Money, so you cannot capture or check cash yet.",
        "Ask the Owner to switch on Money for your account in Settings, then sign in again.",
      ),
    );
  }

  if (tenant.live && cash.count) {
    warnings.push(
      warning(
        "mgmt-second-person",
        "A second person must verify your counts",
        "You cannot verify a cash count that you recorded yourself.",
        "Two people checking the same cash protects against mistakes and missing money.",
        "After you count, ask another person with the verify step to verify it.",
      ),
    );
  }

  return {
    intro:
      "TaxiFlow is the record of your taxi business: daily takings, costs, cash banking, vehicles and drivers. Drivers capture their day on their phones; you review it, check the cash and bank it here.",
    firstStepId: steps.find((item) => item.view === "finance")?.id ?? steps[0]?.id ?? null,
    steps,
    warnings,
  };
};

const buildViewerGuide = ({ views }) => ({
  intro:
    "This is a demo account. You can look around to see how TaxiFlow records takings, costs and vehicles.",
  firstStepId: "viewer-overview",
  steps: views.includes("overview")
    ? [
        step(
          "viewer-overview",
          "overview",
          "Look around Overview",
          "Overview shows a sample day: takings, cash waiting to be checked and vehicle problems.",
        ),
      ]
    : [],
  warnings: [
    warning(
      "viewer-demo",
      "Nothing here is saved",
      "This account only shows demo data.",
      "It lets you try the app without touching a real business.",
      "To work with your own business, ask the Owner for an account.",
    ),
  ],
});

// views: the module ids this account can open right now (the app's nav list).
// cash: the cash steps this account may do. tenant: business-workspace context.
export const buildUserGuide = ({
  role,
  views = [],
  linkedVehicleCount = null,
  cash = { count: false, verify: false, bank: false },
  tenant = {},
} = {}) => {
  const tenantContext = {
    live: Boolean(tenant.live),
    ownerDriver: Boolean(tenant.ownerDriver),
    fleetManage: tenant.fleetManage !== false,
    driversManage: tenant.driversManage !== false,
  };
  const guide =
    role === "Driver"
      ? buildDriverGuide({ views, linkedVehicleCount })
      : role === "Viewer"
        ? buildViewerGuide({ views })
        : buildManagementGuide({ role, views, cash, tenant: tenantContext });

  // One "Open ..." button per screen: later steps on the same screen explain
  // where to tap there instead of repeating the same navigation.
  const seenViews = new Set();
  const steps = guide.steps.map((item) => {
    if (!item.view || seenViews.has(item.view)) {
      return { ...item, actionLabel: null };
    }
    seenViews.add(item.view);
    return item;
  });

  return {
    title: "How to use TaxiFlow",
    role,
    ...guide,
    steps,
    firstStep: steps.find((item) => item.id === guide.firstStepId) ?? null,
  };
};
