import { createClient } from "@supabase/supabase-js";

// LOCAL synthetic stack only: completes the password-setup email that the
// server sent through local Mailpit (127.0.0.1:54324): reads the recovery link,
// verifies it with Supabase Auth and sets the given synthetic local password.
const MAILPIT = "http://127.0.0.1:54324";

export const activateViaEmail = async ({ apiUrl, anonKey, email, password }) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`).then((r) => r.json());
    const message = search.messages?.[0];
    if (message) {
      const full = await fetch(`${MAILPIT}/api/v1/message/${message.ID}`).then((r) => r.json());
      const token = /[?&]token=([^&\s"<>]+)/.exec(full.Text ?? full.HTML ?? "")?.[1];
      if (!token) return { error: "no token in the setup email" };
      const client = createClient(apiUrl, anonKey, { auth: { persistSession: false } });
      const verified = await client.auth.verifyOtp({ token_hash: token, type: "recovery" });
      if (verified.error) return { error: verified.error.message };
      const updated = await client.auth.updateUser({ password });
      if (updated.error) return { error: updated.error.message };
      return { ok: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { error: "no setup email arrived" };
};
