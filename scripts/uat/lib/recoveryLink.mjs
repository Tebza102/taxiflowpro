// Mints a real Supabase Auth recovery link via the admin API instead of requiring a
// human to click a link delivered by email. This tests the exact same server-side
// recovery mechanism (supabase.auth.resetPasswordForEmail + GoTrue's verify
// endpoint) the app's own "Forgot password?" flow uses - it only replaces "wait for
// an email" with "ask Supabase directly for the link it would have sent", which is
// the documented admin.generateLink API, not a workaround of the security model.
export const generateRecoveryActionLink = async ({ supabase, email, redirectTo }) => {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });

  if (error || !data?.properties?.action_link) {
    throw new Error(
      `Failed to generate a Supabase recovery link for ${email}: ${error?.message ?? "no action_link returned"}`,
    );
  }

  return {
    actionLink: data.properties.action_link,
    redirectTo: data.properties.redirect_to ?? null,
  };
};
