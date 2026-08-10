import {
  createServiceClient,
  createUser,
  updateUser,
  resetPassword,
  deleteUser,
} from "../_lib/userLifecycle.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKSPACE_KEY = process.env.SUPABASE_WORKSPACE_KEY || "taxiflow-live";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const createResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });

const validateSession = async (req, supabase) => {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    return { error: "Missing or invalid authorization header", status: 401 };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return { error: "Empty bearer token", status: 401 };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return { error: "Invalid or expired session token", status: 401 };
  }

  if (!user.email) {
    return { error: "Session has no associated email address", status: 401 };
  }

  return { user };
};

export async function POST(req) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return createResponse({ ok: false, error: "Server configuration incomplete" }, 503);
  }

  const supabase = createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const sessionValidation = await validateSession(req, supabase);

  if (sessionValidation.error) {
    return createResponse({ ok: false, error: sessionValidation.error }, sessionValidation.status);
  }

  const { user: sessionUser } = sessionValidation;

  let body;
  try {
    body = await req.json();
  } catch {
    return createResponse({ ok: false, error: "Invalid request body" }, 400);
  }

  const { action, email, name, role, password, staffId, moduleAccess } = body;
  const allowedActions = ["create", "reset-password", "update", "delete"];

  if (!action || !allowedActions.includes(action)) {
    return createResponse({ ok: false, error: "Invalid action specified" }, 400);
  }

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return createResponse({ ok: false, error: "Valid email address required" }, 400);
  }

  const shared = {
    supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: sessionUser.email,
    email,
  };

  let result;

  try {
    if (action === "create") {
      result = await createUser({ ...shared, name, role, password, staffId });
    } else if (action === "update") {
      result = await updateUser({ ...shared, name, role, moduleAccess });
    } else if (action === "reset-password") {
      result = await resetPassword({
        ...shared,
        requesterRole: sessionUser.app_metadata?.role ?? null,
        name,
        password,
      });
    } else {
      result = await deleteUser(shared);
    }
  } catch (error) {
    return createResponse(
      { ok: false, error: error?.message ?? "Unexpected server error during account operation" },
      500,
    );
  }

  return createResponse(result, result.status ?? (result.ok ? 200 : 400));
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}
