# Production email setup for MacroFlow

Use Supabase Auth with Resend SMTP and Cloudflare Turnstile. Supabase still creates accounts and verification/reset links; Resend delivers the messages. No Resend SDK or app-side SMTP password is needed.

This guide uses `example.com` as a placeholder, **not your actual domain**. Replace it everywhere. Your deployed app can be on a Vercel domain, but the email sender must use a domain you own and can edit DNS for. SMTP setup does not require moving your website to that domain.

## 1. Prepare the production project

1. Identify the Supabase project used by the deployed app. Its public Auth URL and server data URL must point to that same project.
2. Complete the database prerequisites and `supabase/signup-login.sql` migration from [auth-setup.md](auth-setup.md). Do not rerun existing prerequisite schemas blindly.
3. Leave `AUTH_SIGNUP_ENABLED=false` while preparing the public launch. This hides/closes the app signup form; it does **not** disable Supabase's public signup endpoint. Use Supabase's own Allow new users to sign up setting when you need a project-wide signup stop.
4. Choose the exact production app origin, for example `https://macroflow.example.com` or your existing `https://your-project.vercel.app`. Use the same origin throughout the following steps.

## 2. Verify a sending domain in Resend

1. Sign in at [Resend](https://resend.com) and open **Domains > Add domain**.
2. Add a dedicated sending subdomain such as `auth.example.com` and choose a sending region. The matching sender will be `noreply@auth.example.com`.
3. Open the DNS dashboard at the provider that manages your domain's nameservers. This may differ from the company where you purchased the domain.
4. Copy **each record Resend actually displays**, including type, name/host, value and MX priority where supplied. These include DKIM and SPF-related sending records. DNS hosts sometimes append your domain automatically: enter names in the format that your provider expects, avoiding `example.com.example.com`.
5. Preserve existing website and mailbox records. Do not enable inbound receiving or replace your root domain's MX records just to send authentication emails. The MX record Resend requests for its sending/return-path subdomain is a separate record; follow the displayed name precisely.
6. Click **Verify** in Resend and wait for the domain's sending status to become **Verified**. DNS changes may take time to propagate.
7. Review DMARC for this sending domain. Preserve any existing policy. If none applies, start with a monitoring policy using Resend's [DMARC guide](https://resend.com/docs/dashboard/domains/dmarc); add a reporting address only if you can receive its reports. Tighten the policy after checking all legitimate senders. SPF/DKIM/DMARC improve authentication; they do not guarantee inbox placement.
8. In the domain settings, keep **click tracking off** for authentication emails so confirmation/reset links are not rewritten. Open tracking is unnecessary for these emails.

Source: [Resend verified domains](https://resend.com/docs/dashboard/domains/introduction).

## 3. Connect Resend SMTP in Supabase

1. In Resend, open **API Keys > Create API Key**. Give it a recognizable name such as `MacroFlow production auth`, choose sending access and restrict it to the verified domain if that option is available.
2. Copy the key privately. This key will be the SMTP password. Do not paste it into chat, source files, or a `NEXT_PUBLIC_` environment variable.
3. Open your production Supabase project, then **Authentication > Email** under **Notifications**, then **SMTP Settings**. Depending on dashboard layout, this may be labelled **Emails / Custom SMTP**.
4. Enable custom SMTP and enter these values:

   | Field | Value |
   | --- | --- |
   | Sender email | `noreply@auth.example.com` (replace with your verified sending domain) |
   | Sender name | `MacroFlow` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | The Resend API key from step 1 |

5. Save the settings. Leave the minimum interval between emails to the same user at **60 seconds** for this rollout. MacroFlow's successful resend/reset request pause assumes that setting.
6. Keep **Confirm email enabled** in **Authentication > Sign In / Providers > Email**. Do not disable verification to avoid a sending quota.

Sources: [Resend's Supabase SMTP instructions](https://resend.com/docs/send-with-supabase-smtp), [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## 4. Budget email capacity before inviting users

1. Check the active Resend plan's daily/monthly quotas and any account restrictions in your dashboard.
2. As checked on **2026-11-01**, Resend's free transactional plan allows **100 emails/day and 3,000/month**. The daily limit resets at midnight UTC (08:00 in the Philippines). This is shared email capacity, not an allowance per user. Check current limits before launch; use an appropriate paid plan if your launch can exceed them.
3. Budget confirmations **plus** retries, resends, password resets and any other messages on that account. For example, 200 new signups in an hour require at least 200 confirmations before resends/recovery. The free plan cannot support that burst even if Supabase's hourly limit is increased.
4. In **Supabase > Authentication > Rate Limits**, adjust **emails sent per hour** to match your expected legitimate traffic and SMTP capacity. Custom SMTP initially has a low **30 messages/hour** limit. A launch expecting 200 signups/hour might start at 300 emails/hour **only with a provider plan/account that supports that volume**, reserving room for recovery and resends.
5. Keep the per-user interval at 60 seconds. The hourly allowance should support many different users; increasing the allowance is separate from allowing one address to request repeated messages.
6. Watch other Auth request/IP limits too. The application uses server-side Auth requests, so traffic may share the hosting server's IP address. Do not assume raising the email quota increases every Auth limit. If legitimate bursts still hit request limits, inspect Supabase Auth logs and the [IP forwarding requirements](https://supabase.com/docs/guides/auth/rate-limits#ip-address-forwarding) before changing request limits. Do not forward an untrusted client-supplied IP or put a secret Supabase key in browser code.

Sources: [Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [Supabase SMTP limit](https://supabase.com/docs/guides/auth/auth-smtp), [Supabase rate limits](https://supabase.com/docs/guides/auth/rate-limits).

## 5. Set production URLs and email templates

1. In your hosting dashboard's **Production** environment variables, set:

   ```dotenv
   NEXT_PUBLIC_APP_URL=https://macroflow.example.com
   AUTH_SIGNUP_ENABLED=false
   ```

   Substitute the actual production origin. Keep the existing Supabase variables pointing at the production project. Do not add a path such as `/journal` to `NEXT_PUBLIC_APP_URL`.
2. In **Supabase > Authentication > URL Configuration**, set **Site URL** to that exact origin.
3. Add the exact **Redirect URL** `https://macroflow.example.com/auth/confirm`, using your actual origin. Avoid broad production wildcard redirects. Prefer a separate Supabase project for localhost and preview deployments.
4. In **Authentication > Email > Templates**, replace **Confirm signup** with the contents of [confirmation.html](../supabase/templates/confirmation.html) and **Reset password** with [recovery.html](../supabase/templates/recovery.html). Use subjects such as `Confirm your MacroFlow email` and `Reset your MacroFlow password`.
5. Preserve `{{ .SiteURL }}`, `{{ .TokenHash }}` and the `type=email` / `type=recovery` query parameters. These existing templates support opening the email in another browser.

The sender domain and the app domain may differ. **Site URL** is always the deployed **app** origin, not `smtp.resend.com` or the email-only subdomain.

## 6. Enable Cloudflare Turnstile in the right order

The app includes an optional widget for signup, login, resend and forgotten-password forms. Supabase verifies the token. The authenticated password update form does not need a new CAPTCHA challenge.

1. Open **Cloudflare > Turnstile > Add widget**. Your website does not need to use Cloudflare DNS for Turnstile.
2. Name it `MacroFlow production`, select **Managed**, and add your exact production **hostname** (no `https://` and no path). Add each hostname from which users actually open your auth forms. Do not use production keys in disposable local integration tests.
3. Copy the widget's **site key** to the hosting dashboard's Production environment:

   ```dotenv
   NEXT_PUBLIC_TURNSTILE_SITE_KEY=your-public-site-key
   ```

   This value is public. The matching **secret key** belongs only in Supabase's CAPTCHA settings.
4. **Build and deploy this app with the public site key first.** Public environment variables are included at build time, so changing the variable requires a new build. Check that the security widget appears and completes on `/login`, `/signup` (when enabled), `/check-email` and `/forgot-password`.
5. Only after the deployed widget works, open **Supabase > Authentication > Bot and Abuse Protection** (sometimes **Attack Protection**). Enable **CAPTCHA protection**, choose **Cloudflare Turnstile**, paste the matching **secret key**, and save.
6. Test login and forgotten password immediately. Then test signup and resend as described below. A missing/invalid/expired token must fail; Supabase must enforce CAPTCHA too, because the public Auth API can be called directly.
7. If the widget cannot load, the form stays disabled and asks the user to refresh. If your deployment sets a Content Security Policy, permit `https://challenges.cloudflare.com` for the widget's scripts and frames as described in [Cloudflare's CSP guidance](https://developers.cloudflare.com/turnstile/reference/content-security-policy/).

For rollback, disable CAPTCHA in Supabase **before** deploying a build without the widget/site key, or authentication can be blocked. For a temporary widget outage, disable CAPTCHA and deploy with the public site key cleared. Do not disable email confirmation.

Sources: [Supabase CAPTCHA setup](https://supabase.com/docs/guides/auth/auth-captcha), [Cloudflare widget setup](https://developers.cloudflare.com/turnstile/get-started/widget-management/).

## 7. Test on the deployed app, then invite users

1. Enable Supabase's **Allow new users to sign up** if it was disabled. Set `AUTH_SIGNUP_ENABLED=true` in the app's Production environment, rebuild/redeploy, and keep the URL private while doing the initial smoke test. The flag is a rollout switch, not an invitation-only access control.
2. In a private browser window, sign up using a real test address that is **not** a member of the Supabase team. Complete Turnstile and check inbox/spam. Open the newest confirmation link and verify it goes to your production `/journal/welcome`. Complete onboarding and confirm journal access.
3. Sign out and sign in again. Verify an unconfirmed account cannot enter the journal.
4. Test resend using another unconfirmed test address. Wait at least 60 seconds after its signup, then use `/check-email`. Open only the newest email. Successful requests show an acknowledgement and local 60-second pause.
5. Use `/forgot-password`, open the reset email, set a new password, and sign in with it. Check that the old password no longer works.
6. Repeat signup with a second unrelated inbox provider if possible. Verify that the confirmation link also works when opened in a different browser with the repository's token-hash templates.
7. Inspect **Resend email logs** for delivery/bounce failures and **Supabase Auth logs** for sending, CAPTCHA or request-limit errors. Watch application logs for `[auth] Email sending rate limit reached.` and `[auth] Email delivery unavailable.`. Logs intentionally omit submitted addresses, passwords and tokens.
8. Invite a small first group, confirm delivery and quota headroom, then open the launch to more users. Recheck your sending plan before a larger batch.

If an email limit is hit, MacroFlow shows a retry-later message without guessing the provider's reset time. Its 60-second pause after an accepted request is a local resend convenience; it is neither an hourly quota reset nor server-side abuse prevention. Recovery/resend acknowledgements remain identical for known and unknown addresses.

## Troubleshooting

- **Still only two emails/hour or email address not authorized:** confirm custom SMTP is saved in the same Supabase project used by the deployed app.
- **SMTP authentication failed:** check Resend host, port, username and API key; inspect Supabase Auth logs. Keep the key private.
- **Sender/domain rejected:** the From address must match the Resend domain verified for that key.
- **Email limit reached:** check both Supabase's hourly allowance and Resend's daily/monthly account capacity. Raising one does not raise the other.
- **General Too many attempts message:** inspect Auth request/IP limits too; this is not proof that the SMTP email quota is exhausted.
- **Email marked delivered but absent:** inspect spam, recipient filtering/suppression and authentication results in the received message's headers. Provider delivery does not guarantee inbox placement.
- **Security check fails:** verify site/secret keys match, hostname is allowed, the deployed build has the public key, and Supabase uses Turnstile rather than hCaptcha. Refresh for a new token. Both app and Supabase configuration must agree.
- **Link goes to localhost or the wrong site:** fix Site URL, Redirect URLs and `NEXT_PUBLIC_APP_URL`, rebuild/redeploy, then request a new link. Already-sent emails keep their old URLs.
- **Link expired/already used:** use the newest email or sign in if the account is already confirmed. Turn off click tracking; email security scanners can also consume one-time links.

These are configuration and deployment steps for your accounts. Local automated tests do not prove production DNS, SMTP delivery, quotas or Supabase dashboard settings are correct.
