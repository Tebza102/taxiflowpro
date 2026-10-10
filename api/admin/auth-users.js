// Retired legacy route. Accounts and roles are managed only through business
// memberships: POST /api/business/members (Owner) and the operator onboarding
// procedures. This route no longer depends on any environment setting, so no
// configuration can bring back the legacy appUsers account path.
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

export async function POST() {
  return createResponse({ ok: false, error: "User accounts are managed through business access in this deployment." }, 410);
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
