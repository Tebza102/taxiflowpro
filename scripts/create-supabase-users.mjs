import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const defaultPassword = process.env.SUPABASE_SEED_PASSWORD ?? "TaxiFlow.123";

const users = [
  { email: "owner@taxiflow.local", role: "Owner" },
  { email: "admin@taxiflow.local", role: "Admin" },
  { email: "manager@taxiflow.local", role: "Manager" },
  { email: "viewer@taxiflow.local", role: "Viewer" },
  { email: "driver.one@taxiflow.local", role: "Driver" },
  { email: "driver.two@taxiflow.local", role: "Driver" },
];

if (!supabaseUrl) {
  console.error("Missing SUPABASE_URL or VITE_SUPABASE_URL.");
  process.exit(1);
}

if (!serviceRoleKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const buildMetadata = (role) => ({
  role,
  app_role: role,
});

const findUserByEmail = async (email) => {
  const { data, error } = await supabase.auth.admin.listUsers();

  if (error) {
    throw error;
  }

  return data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null;
};

const ensureUser = async ({ email, role }) => {
  const existing = await findUserByEmail(email);

  if (!existing) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: defaultPassword,
      email_confirm: true,
      user_metadata: buildMetadata(role),
      app_metadata: buildMetadata(role),
    });

    if (error) {
      throw error;
    }

    console.log(`Created ${email} (${role})`);
    return data.user;
  }

  const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
    password: defaultPassword,
    email_confirm: true,
    user_metadata: {
      ...(existing.user_metadata ?? {}),
      ...buildMetadata(role),
    },
    app_metadata: {
      ...(existing.app_metadata ?? {}),
      ...buildMetadata(role),
    },
  });

  if (error) {
    throw error;
  }

  console.log(`Updated ${email} (${role})`);
  return data.user;
};

try {
  for (const user of users) {
    await ensureUser(user);
  }

  console.log("Supabase Auth users are ready.");
} catch (error) {
  console.error(error.message ?? error);
  process.exit(1);
}
