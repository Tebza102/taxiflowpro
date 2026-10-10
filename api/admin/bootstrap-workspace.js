// Retired legacy route. Businesses and their first Owner are created only by the
// operator onboarding procedures; access comes only from business memberships.
// This route no longer depends on any environment setting, so no configuration
// can bring back the legacy taxiflow-live bootstrap.
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
  return createResponse({ ok: false, error: "Workspace bootstrap is managed through business access in this deployment." }, 410);
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
