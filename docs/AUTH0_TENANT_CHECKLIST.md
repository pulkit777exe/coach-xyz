# Auth0 Tenant Checklist

Provisioning checklist for the Auth0 tenant backing CoachXYZ (`@auth0/nextjs-auth0`
v4, env-driven — see `web-next/lib/auth0.ts`). Complete top to bottom when
creating a tenant or rotating credentials.

## 1. Tenant

- [ ] Region matches the deployment (US/EU) — user data residency.
- [ ] Friendly tenant name set (shows on the login page).
- [ ] Admin MFA enabled on the tenant admin account.

## 2. Application (Regular Web Application)

- [ ] Application type: Regular Web Application.
- [ ] Allowed Callback URLs (one per environment, comma-separated):
  - local: `http://localhost:3000/auth/callback`
  - prod: `<APP_BASE_URL>/auth/callback`
- [ ] Allowed Logout URLs:
  - local: `http://localhost:3000`
  - prod: `<APP_BASE_URL>`
- [ ] Allowed Web Origins:
  - local: `http://localhost:3000`
  - prod: `<APP_BASE_URL>`
- [ ] Refresh Token Rotation enabled (the SDK keeps the session alive).
- [ ] Client Secret stored — never committed (see §4).

## 3. Connections

- [ ] Database connection (`Username-Password-Authentication`) enabled for the app.
- [ ] Password policy at least Fair; breached-password detection on.
- [ ] Brute-force protection on.
- [ ] Social connections (Google, etc.) only if the product needs them — each
      one must be enabled per-application, not just per-tenant.
- [ ] Email provider configured (Auth0 built-in is dev-only; attach a custom
      provider before inviting real staff).

## 4. Environment variables

Web (`web-next/.env`, see `web-next/.env.example`):

- [ ] `AUTH0_DOMAIN` — tenant domain, no scheme (e.g. `xyz.us.auth0.com`).
- [ ] `AUTH0_CLIENT_ID` / `AUTH0_CLIENT_SECRET` — from §2.
- [ ] `AUTH0_SECRET` — 64-char hex (`openssl rand -hex 32`); session cookie
      encryption. Rotating logs everyone out.
- [ ] `APP_BASE_URL` — must exactly match the §2 callback/logout origins
      (scheme + host, no trailing slash).

Server needs no Auth0 variables — it trusts the web proxy via `SERVICE_TOKEN`
+ `x-verified-auth0-id` (see `server/src/lib/serviceGuard.ts`).

## 5. Verify

- [ ] `GET /auth/login` redirects to the tenant login page.
- [ ] Login lands back on `/` and `/account` shows the profile.
- [ ] Logout returns to `/` and clears the session (`/dashboard` redirects to
      `/auth/login`).
- [ ] With `SERVICE_TOKEN` set on both sides, dashboard pages load (proxy
      injects the verified sub; a mismatch is a 403, not a login loop).
- [ ] Invite flow: staff invited by email can sign in and see the org
      (`/invite?token=…` accepts, `/api/me/orgs` lists it).

## 6. Rotation

- [ ] New secret first: add the replacement client secret in Auth0, deploy
      with it, then remove the old one.
- [ ] `AUTH0_SECRET` rotation forces re-login for all sessions — announce it.
- [ ] After rotation, re-run §5 end to end before closing the change.
