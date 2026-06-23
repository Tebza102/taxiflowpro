# Security Checklist

## Secrets
- [ ] No secrets committed to Git.
- [ ] Private keys are server-only.
- [ ] Environment variable docs show names only, not values.

## Authentication
- [ ] Protected routes require login.
- [ ] Role checks cannot be bypassed from the frontend only.
- [ ] Session handling works correctly.

## Database
- [ ] Users can only access allowed data.
- [ ] Admin actions are protected.
- [ ] Write operations are validated.

## API
- [ ] Inputs are validated.
- [ ] File uploads are restricted by type and size.
- [ ] Sensitive errors are not exposed to users.
- [ ] Rate limits considered for public endpoints.

## Deployment
- [ ] Preview and production environments are separated.
- [ ] Debug logs do not expose sensitive values.
