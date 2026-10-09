import { createServiceClient } from "../_lib/userLifecycle.js";
import { bootstrapWorkspace } from "../_lib/workspaceBootstrap.js";
import { resolveServerWorkspaceKey } from "../_lib/workspaceKey.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKSPACE_KEY = resolveServerWorkspaceKey();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const createResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

export async function POST(req) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return createResponse({ ok: false, error: "Server configuration incomplete" }, 503);
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    return createResponse({ ok: false, error: "Missing or invalid authorization header" }, 401);
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return createResponse({ ok: false, error: "Empty bearer token" }, 401);
  }

  const supabase = createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user?.email) {
    return createResponse({ ok: false, error: "Invalid or expired session token" }, 401);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return createResponse({ ok: false, error: "Invalid request body" }, 400);
  }

  let result;
  try {
    result = await bootstrapWorkspace({
      supabase,
      workspaceKey: WORKSPACE_KEY,
      requesterEmail: user.email,
      clientSnapshot: body?.snapshot ?? null,
    });
  } catch (error) {
    return createResponse(
      { ok: false, error: error?.message ?? "Unexpected server error during workspace bootstrap" },
      500,
    );
  }

  return createResponse(result, result.status ?? (result.ok ? 200 : 400));
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
