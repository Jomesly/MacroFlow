# MacroFlow

MacroFlow combines a macroeconomic market dashboard with a personal trading journal. Review daily market context, record trades, and evaluate performance alongside the conditions behind each decision.

## Features

- **Market dashboard:** daily bias, event detail, dollar-index context, upcoming economic releases, and data-source status for gold, Bitcoin, major US indices, and GBP/USD.
- **Personal journal:** record trades, review history, and retain market-bias context at entry.
- **Analytics:** performance totals, a P&L calendar, and breakdowns by symbol, tag, session, and weekday. Monetary metrics report coverage when trade records are incomplete.
- **Account access:** email/password signup, verification, password recovery, and free beta access for verified users with an active journal grant.
- **MT5 connection:** download the Expert Advisor, create a revocable journal API key, and synchronize closed trades without storing broker passwords.

The journal is in beta. Analytics and broker synchronization require further reconciliation before broader release. Market context is informational and does not constitute investment advice.

## Technology

| Area | Stack |
| --- | --- |
| Application | Next.js 16, React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| Authentication and journal storage | Supabase Auth and PostgreSQL |
| Shared cache and market history | Upstash Redis |
| Validation | Zod |
| Testing | Vitest and Playwright |

## Local development

Use Node.js 20.9 or later and npm.

```bash
npm install
```

Copy `.env.example` to `.env.local` and configure the services you intend to use. In PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Preserve an existing `.env.local` instead of overwriting it.

| Configuration | Purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server-side journal storage and administration |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Authentication against the same Supabase project |
| `NEXT_PUBLIC_APP_URL` | Exact application origin; use `http://localhost:3000` locally |
| `AUTH_SIGNUP_ENABLED` | Registration rollout flag; leave `false` until database and email setup are ready |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Shared market-data cache and history |
| Market-provider and RSS settings | Dashboard data sources; see `.env.example` |

Keep service-role credentials on the server. Never place them in a `NEXT_PUBLIC_` variable or commit local environment files.

### Database and authentication

Follow the [authentication setup guide](docs/auth-setup.md) before enabling signup. It covers schema prerequisites, migration order, email templates, redirects, SMTP, access grants, and rollback.

For a new database, review the SQL files in this order:

1. `supabase/schema.sql`
2. `supabase/subscribers.sql`
3. `supabase/journal-autosync.sql`
4. `supabase/signup-login.sql`

Inspect and back up existing databases first. Some prerequisite scripts are not rerunnable migrations; do not reapply them blindly to a live project.

Configure Supabase's Site URL and confirmation redirect URL to match your application origin. Enable email confirmation and configure custom SMTP before public registration. The built-in sender has a small project-wide quota; repeated signup, resend, and recovery tests can exhaust it.

Once configuration is ready:

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000) for the market dashboard. Use `/signup` to create an account or `/login` for an existing one. Accounts use individual Supabase Auth credentials.

Standard Supabase confirmation links must be opened in the browser that initiated signup. The token-hash templates supplied in `supabase/templates/` also support verification in another browser.

## Checks

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

The current repository has known lint findings in the historical-calendar script, market-data code, and an engine test. Review the output before treating lint as a release gate.

For browser and database integration tests on Windows, start Docker Desktop and run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/test-auth-local.ps1
```

The runner creates a disposable local Supabase stack and a separate app on port 3137. It does not use hosted credentials or reset a hosted database. See the [setup guide](docs/auth-setup.md#local-integration-tests-windows) for ports, focused test runs, and cleanup behavior.

## Project structure

```text
src/app/          Application pages, authentication, and API routes
src/components/  Dashboard, journal, and account interfaces
src/lib/         Market data, scoring, journal storage, and access checks
supabase/        Database scripts, email templates, and SQL assertions
public/          Downloadable MT5 Expert Advisor
scripts/         Historical-data utilities and local test runner
tests/e2e/       Browser integration tests
docs/            Setup and backtesting documentation
```

## Deployment

`main` is the production branch. Develop and review changes on feature branches before merging.

For journal rollout, apply the reviewed database migration first, deploy the compatible application, verify confirmation and recovery on the deployed origin, then enable registrations. Local test success does not verify hosted SMTP, redirect settings, or production data readiness.
