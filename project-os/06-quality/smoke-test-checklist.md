# Smoke Test Checklist

Use this after every meaningful code change and before deployment.

## Local Setup
- [ ] Dependencies install successfully.
- [ ] Development server starts.
- [ ] No critical terminal errors.
- [ ] No critical browser console errors.

## Routing
- [ ] Home page loads.
- [ ] Main app pages load.
- [ ] Protected routes behave correctly.
- [ ] Unknown route shows a safe 404 or redirect.

## Authentication
- [ ] Login page loads.
- [ ] Signup or account creation behaves as expected.
- [ ] Logout works.
- [ ] Auth state persists after refresh.
- [ ] Unauthorized users are blocked from protected pages.

## Core Workflow
- [ ] Primary user journey works from start to finish.
- [ ] Data saves or processes correctly.
- [ ] Error states are clear.
- [ ] Loading states appear where needed.

## Database/API
- [ ] API calls succeed.
- [ ] Database reads work.
- [ ] Database writes work.
- [ ] Security rules or policies do not block valid users.

## Deployment Readiness
- [ ] Production build succeeds.
- [ ] Required environment variables exist in deployment platform.
- [ ] Live deployment loads.
- [ ] Live main workflow works.
