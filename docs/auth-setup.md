# Signup and free beta journal setup

Verified users with active journal access can log trades, review History/Analytics and connect MT5 without paying. Login credentials live in Supabase Auth. Do not insert passwords into subscribers or profiles, and do not look for a shared/default journal password.

## Run the application

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` if you do not already have local settings. Preserve existing provider settings.
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for server data/admin access. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for Auth, targeting the same project. Never expose the service-role key in a `NEXT_PUBLIC_` variable.
4. Set `NEXT_PUBLIC_APP_URL` to the exact app origin, for example `http://localhost:3000` locally or your HTTPS deployment origin. It must have no path, credentials, query or fragment. If you use another port, update this value and Supabase URLs together.
5. Prepare the database and Auth configuration below. Set `AUTH_SIGNUP_ENABLED=true` only after they are ready. It defaults to disabled; existing users can still sign in.
6. Run `npm run dev`, visit `/signup`, create your own account, open the verification email, and finish welcome. Existing users use `/login`; forgotten passwords use `/forgot-password`.

## Database migration

Inspect the intended project's schema and back it up before deployment. The existing journal schemas must already be present: `supabase/schema.sql`, `supabase/subscribers.sql`, `supabase/journal-autosync.sql`. The subscribers script is not a rerunnable migration; do not blindly rerun existing schema files against a live project.

Review and apply **`supabase/signup-login.sql`** in the target project's SQL Editor. It creates server-only profiles/access, adds a minimal Auth INSERT trigger, and backfills existing identities. It can be rerun without resetting preferences or permissions. Confirm existing tables with the same names match this schema before applying it.

- Active subscribers retain active legacy access.
- Inactive/cancelled subscribers retain denied access.
- Other Auth users receive beta grants, conditional on email verification.
- New Auth identities receive profiles and beta grants automatically. Unverified identities cannot use them yet.
- Subscriber records and trades remain unchanged. Null-owned legacy trades stay unassigned and invisible to new users. Inspect `select count(*) from public.trades where user_id is null;` and resolve ownership separately; never guess an owner from signup/email.

Access is now governed by `public.journal_access`, separately from subscriptions. A missing row is a provisioning error and results in retryable 503; login never silently creates/restores a grant. To inspect a user, use the Auth UUID and read that user's profile/access rows through trusted administration.

Trusted revoke/restore operation (substitute the known Auth UUID and chosen status):

```sql
update public.journal_access
set status = 'revoked', updated_at = now()
where user_id = 'AUTH-USER-UUID';
-- Restore deliberately with status = 'active'.
```

Updating subscribers.status alone no longer changes journal permission. Revocation blocks browser APIs and MT5 on the next request; restoration allows non-revoked keys again. Revoked keys require a new key. There is no new admin interface or billing webhook in this release.

## Supabase Auth and email

Enable email/password signup and **Confirm Email**. Configure a minimum password length of at least 8 (the app validates 8–128 characters; Supabase enforces any stronger configured requirements). Keep the actual password policy and user-facing guidance aligned. Keep the normal one-hour JWT lifetime in production; avoid lifetimes below five minutes because the SDK refreshes ahead of expiry. Enable public signup only after testing confirmation and recovery on the deployed origin. [Supabase session configuration](https://supabase.com/docs/guides/auth/sessions).

Set **Site URL** to the same origin as `NEXT_PUBLIC_APP_URL`. Allow the exact application confirmation URL, such as `http://localhost:3000/auth/confirm`, in Redirect URLs. Use separate settings/projects for development and production; do not add broad production wildcards.

Copy `supabase/templates/confirmation.html` into the Confirm signup email template, and `supabase/templates/recovery.html` into Reset password. Their links use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` or `type=recovery`; preserve the token-hash flow. It supports opening mail in another browser without the signup browser's PKCE verifier. Do not substitute a URL-fragment-only callback.

The app also supports standard Supabase email templates that redirect to `/auth/confirm?code=...`: it exchanges the one-time PKCE code for a cookie session. Open these links in the same browser/device where signup or recovery was requested. Recovery uses the SDK's stored recovery marker to reach the password-reset page. A missing verifier shows same-browser/sign-in guidance rather than granting access. PKCE codes expire after five minutes and can be exchanged only once. [Supabase PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

Configure custom SMTP before public use. Supabase's default sender is limited to preauthorized team addresses and is unsuitable for public verification/recovery. Configure provider email limits and verify inbox/spam delivery. The app honors provider throttling and shows a resend delay; it does not claim a client timer prevents abuse. [Supabase SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp).

Check email links, expired/reused links and password recovery end to end. Public reset acknowledgement is identical for unknown/known addresses. An authenticated user may also use the reset page to change their own password. After updating, this browser signs out; the app does not promise other devices' sessions were revoked.

## Local integration tests (Windows)

Docker Desktop must be running. From the repository root:

```powershell
npm install
powershell -ExecutionPolicy Bypass -File scripts/test-auth-local.ps1
```

This creates an **unlinked disposable Supabase project** under `%TEMP%/macroflow-auth-tests`, with Auth/Postgres/Mailpit on ports 55321/55322/55324, and an isolated app server on 3137. It resets only that test project's local database, runs migration/backfill/rerun/rollback assertions, installs Chromium if necessary and executes the browser integration suite. A five-minute test token verifies refresh past actual expiry, so allow several minutes for the suite. The script refuses to reuse another app on port 3137, never reads hosted credentials from `.env.local`, and temporarily overrides data/Auth settings for the child app. Logs and local test keys remain in the temp directory; do not publish those logs.

The script stops its app and Supabase services afterward, preserving test volumes/logs; `-KeepServices` leaves only the local Supabase stack available for inspection. It never edits `.env.local` or links/resets a hosted project. Unit tests run separately with `npm test`.

Use `-TestPattern 'standard|verified signup|email recovery|open journal'` for focused confirmation/recovery checks. The test app uses `.next-auth-tests` so it can run beside your normal development server. Local-only `confirmation-test.html` and `recovery-test.html` fixtures exercise both token-hash and standard Supabase links; use the normal templates above for your hosted project.

## Rollout and troubleshooting

Local validation completed on 2026-10-31: 150 unit tests, all four Chromium integration tests, SQL migration assertions, TypeScript and production build pass. Browser checks include second-browser confirmation, recovery, cross-user isolation, revocation/MT5, multiple-tab account switching and concurrent refresh after actual token expiry. Repository lint has four preexisting errors and four warnings outside this auth slice. These results do not verify hosted configuration.

Confirmation callback follow-up on 2026-10-31: reproduced standard Supabase confirmation and recovery failures before adding PKCE code exchange. After the fix, all 156 unit tests, five focused Chromium tests, SQL migration assertions, TypeScript, production build and scoped ESLint pass. The focused run includes both email-link formats and account switching; it excludes the previously validated five-minute concurrent-refresh test. Hosted email templates and settings were not changed or tested by this local run.

Deploy schema/backfill first, then the app, then enable registrations after email checks pass. Existing users may need one new login when the old single access-token cookie is retired. Signing out clears current-browser journal state, but does not revoke MT5 keys or sign out other devices. Sign-in/signup/password-change attempts and logout notify other open journal tabs to discard their state. Tabs also verify identity before displaying the journal and when resumed; requests include the mounted journal's expected owner so a retained draft cannot write through another account's cookies. If browser storage is disabled, focus checks and server request binding still apply.

Email confirmation preserves retryable Auth outages (503) and throttling (429) instead of reporting these as an expired link. Retry the same link after the indicated delay.

- **Registration closed:** check server `AUTH_SIGNUP_ENABLED`, then redeploy/restart after changing environment settings.
- **Email does not arrive:** check SMTP, Confirm Email, email limits and Site/Redirect URLs. Resend on `/check-email`.
- **Email is verified but the callback says invalid link:** run the current app build, which supports standard PKCE code exchange. Expired or already-consumed links cannot be reused; sign in with your password for an already-verified account. For a new standard-link test, use the newest email in the initiating browser. The custom token-hash templates also support another browser.
- **Access unavailable:** inspect the exact Auth UUID's journal_access row; there is no payment requirement during beta.
- **Temporary access/profile error:** inspect migration/configuration and service availability. Do not grant access via signup metadata or repair permissions through profile edits.
- **Legacy Redis migration script:** the service-role module is now guarded by `server-only`. Run that existing one-time CLI with Node's `react-server` condition, for example set `$env:NODE_OPTIONS='--conditions=react-server'` for that command, then restore the prior value.

Rollback by disabling signup and deploying a compatible build. Preserve Auth users, trades and access records. Keep the new access layer or a tested compatibility patch: the old subscriber-only application cannot authorize new beta users. Hosted migration/SMTP/deployment are separate release steps; local integration success is not proof of hosted configuration.
