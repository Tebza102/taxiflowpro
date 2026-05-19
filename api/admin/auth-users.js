import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

const validateAdminSession = async (req) => {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    return { error: "Missing or invalid authorization header", status: 401 };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return { error: "Empty bearer token", status: 401 };
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { error: "Server configuration incomplete", status: 503 };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return { error: "Invalid or expired session token", status: 401 };
  }

  const userRole = user.app_metadata?.role ?? user.user_metadata?.role ?? null;
  if (!["Owner", "Admin", "Manager"].includes(userRole)) {
    return { error: "Insufficient permissions for admin operations", status: 403 };
  }

  return { user, userRole, supabase };
};

export async function POST(req) {
  const sessionValidation = await validateAdminSession(req);
  if (sessionValidation.error) {
    return createResponse(
      { ok: false, error: sessionValidation.error },
      sessionValidation.status,
    );
  }

  const { user, userRole, supabase } = sessionValidation;

  let body;
  try {
    body = await req.json();
  } catch {
    return createResponse({ ok: false, error: "Invalid request body" }, 400);
  }

  const { action, email, name, role, password, actorId } = body;

  if (!action || !["create", "reset-password", "update"].includes(action)) {
    return createResponse({ ok: false, error: "Invalid action specified" }, 400);
  }

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return createResponse({ ok: false, error: "Valid email address required" }, 400);
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (action === "create") {
    if (userRole !== "Owner") {
      return createResponse({ ok: false, error: "Only the owner can create new user accounts" }, 403);
    }

    if (!role || !["Owner", "Admin", "Manager", "Driver", "Viewer"].includes(role)) {
      return createResponse({ ok: false, error: "Valid role required for user creation" }, 400);
    }

    if (!password || password.length < 6) {
      return createResponse({ ok: false, error: "Password must be at least 6 characters long" }, 400);
    }

    const existingUsers = await supabase.auth.admin.listUsers();
    if (existingUsers.error) {
      return createResponse({ ok: false, error: "Failed to check existing users" }, 502);
    }

    const existingUser = existingUsers.data.users.find(
      (u) => u.email?.toLowerCase() === normalizedEmail,
    );

    if (existingUser) {
      return createResponse({ ok: false, error: "User already exists in Supabase Auth" }, 409);
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        name: name || normalizedEmail,
        role,
        staffId: body.staffId ?? null,
      },
      app_metadata: {
        role,
        staff_id: body.staffId ?? null,
      },
    });

    if (error) {
      return createResponse({ ok: false, error: error.message }, 502);
    }

    return createResponse({
      ok: true,
      message: `User ${normalizedEmail} created in Supabase Auth`,
      user: {
        id: data.user.id,
        email: data.user.email,
        role: data.user.app_metadata?.role ?? role,
      },
    });
  }

  if (action === "reset-password" || action === "update") {
    if (!["Owner", "Admin", "Manager"].includes(userRole)) {
      return createResponse({ ok: false, error: "Insufficient permissions for password reset" }, 403);
    }

    const existingUsers = await supabase.auth.admin.listUsers();
    if (existingUsers.error) {
      return createResponse({ ok: false, error: "Failed to find user in Supabase Auth" }, 502);
    }

    const existingUser = existingUsers.data.users.find(
      (u) => u.email?.toLowerCase() === normalizedEmail,
    );

    if (!existingUser) {
      return createResponse({ ok: false, error: "User not found in Supabase Auth" }, 404);
    }

    const updates = {
      email_confirm: true,
      user_metadata: {
        ...(existingUser.user_metadata ?? {}),
        name: name || existingUser.user_metadata?.name || normalizedEmail,
      },
      app_metadata: {
        ...(existingUser.app_metadata ?? {}),
      },
    };

    if (password && password.length >= 6) {
      updates.password = password;
    }

    const { data, error } = await supabase.auth.admin.updateUserById(existingUser.id, updates);

    if (error) {
      return createResponse({ ok: false, error: error.message }, 502);
    }

    return createResponse({
      ok: true,
      message: password ? `Password reset for ${normalizedEmail}` : `User ${normalizedEmail} updated`,
      user: {
        id: data.user.id,
        email: data.user.email,
        role: data.user.app_metadata?.role ?? existingUser.app_metadata?.role,
      },
    });
  }

  return createResponse({ ok: false, error: "Unknown action" }, 400);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}
