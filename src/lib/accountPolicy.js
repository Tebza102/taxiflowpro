// Single source of truth for the live-mode Supabase Auth password minimum, shared
// between the server user lifecycle (api/_lib/userLifecycle.js) and any client-side
// form validation (src/App.jsx) that gates a live login-creation submission. Keeping
// this in one place avoids the client accepting a password the server then rejects.
export const MIN_LIVE_LOGIN_PASSWORD_LENGTH = 8;
