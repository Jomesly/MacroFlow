param([switch]$SetupOnly, [switch]$BaseOnly, [switch]$AppOnly)

# A separate, disposable local project. This script never links to Supabase Cloud.
$ErrorActionPreference = 'Stop'
$screenshotRepo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$screenshotProject = 'macroflow-screenshot-eval'
$screenshotRoot = Join-Path $env:TEMP $screenshotProject
$screenshotContainer = "supabase_db_$screenshotProject"
$screenshotApi = 'http://127.0.0.1:55721'
$screenshotApp = 'http://localhost:3004'
$screenshotStatusFile = Join-Path $screenshotRoot 'status.json'

function Invoke-ScreenshotSql([string[]]$Files) {
  $sqlArguments = @('exec', $screenshotContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1')
  foreach ($file in $Files) { $sqlArguments += @('-f', "/tmp/macroflow-sql/$file") }
  & docker @sqlArguments
  if ($LASTEXITCODE -ne 0) { throw "Local screenshot migration failed: $($Files -join ', ')." }
}

New-Item -ItemType Directory -Force -Path (Join-Path $screenshotRoot 'supabase/templates') | Out-Null
Push-Location $screenshotRepo
try {
  if (!$AppOnly) {
    $screenshotConfig = (Get-Content (Join-Path $screenshotRepo 'supabase/auth-test.config.toml') -Raw).
      Replace('macroflow-auth-tests', $screenshotProject).Replace('553', '557').Replace('3137', '3004').Replace('jwt_expiry = 300', 'jwt_expiry = 3600')
    Set-Content -LiteralPath (Join-Path $screenshotRoot 'supabase/config.toml') -Value $screenshotConfig -Encoding utf8
    Copy-Item -Path (Join-Path $screenshotRepo 'supabase/templates/*.html') -Destination (Join-Path $screenshotRoot 'supabase/templates')
    $ErrorActionPreference = 'Continue'
    npx --yes supabase start --workdir $screenshotRoot --exclude imgproxy,studio,postgres-meta,realtime,edge-runtime,logflare,vector,supavisor *> (Join-Path $screenshotRoot 'supabase-start.log')
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0) { throw "Local Supabase startup failed. Read $screenshotRoot/supabase-start.log." }
    $ErrorActionPreference = 'Continue'
    $screenshotStatusText = npx --yes supabase status --workdir $screenshotRoot -o json 2> (Join-Path $screenshotRoot 'supabase-status.log')
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the local screenshot project status.' }
    $screenshotStatusText | Set-Content -LiteralPath $screenshotStatusFile -Encoding utf8
  }
  if (!(Test-Path -LiteralPath $screenshotStatusFile)) { throw 'Run setup once before using -AppOnly.' }
  $screenshotStatus = Get-Content -LiteralPath $screenshotStatusFile -Raw | ConvertFrom-Json
  if ($screenshotStatus.API_URL -ne $screenshotApi) { throw 'Refusing an unexpected Supabase API URL.' }
  if ($screenshotStatus.DB_URL -notmatch '^postgresql://postgres:.*@127\.0\.0\.1:55722/postgres$') { throw 'Refusing an unexpected Supabase database URL.' }

  if (!$AppOnly) {
    docker exec $screenshotContainer mkdir -p /tmp/macroflow-sql
    docker cp (Join-Path $screenshotRepo 'supabase/.') "${screenshotContainer}:/tmp/macroflow-sql"
    if ($LASTEXITCODE -ne 0) { throw 'Could not copy local migration files.' }
    $screenshotHasSchema = docker exec $screenshotContainer psql -U postgres -d postgres -Atc "select to_regclass('public.trades') is not null"
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the local database.' }
    if ($screenshotHasSchema -eq 'f') {
      Invoke-ScreenshotSql @('schema.sql', 'subscribers.sql', 'journal-autosync.sql', 'signup-login.sql')
    }
    $screenshotHasJournal = docker exec $screenshotContainer psql -U postgres -d postgres -Atc "select to_regclass('public.journal_accounts') is not null"
    if ($screenshotHasJournal -eq 'f') {
      Invoke-ScreenshotSql @('trading-accounts.sql', 'journal-account-funds.sql', 'journal-imports.sql')
    }
    $screenshotHasAccounts = docker exec $screenshotContainer psql -U postgres -d postgres -Atc "select exists (select 1 from information_schema.columns where table_schema='public' and table_name='broker_accounts' and column_name='lifecycle')"
    if ($screenshotHasAccounts -eq 'f') { Invoke-ScreenshotSql @('account-management.sql') }
    Invoke-ScreenshotSql @('account-management-hardening.sql', 'account-management-journal-compat.sql', 'journal-trade-symbols.sql', 'journal-ingest-skip-unchanged.sql', 'journal-screenshots.sql')
    if ($BaseOnly) {
      Write-Host "Base screenshot evaluator is ready at $screenshotApi, with real Storage. Status: $screenshotStatusFile"
      return
    }
    if (!(Test-Path -LiteralPath 'supabase/journal-screenshot-lifecycle.sql')) { throw 'The screenshot lifecycle migration must exist before starting the feature evaluator.' }
    Invoke-ScreenshotSql @('journal-screenshot-lifecycle.sql')
    $screenshotBackfillDone = $false
    for ($screenshotPage = 0; $screenshotPage -lt 1000 -and !$screenshotBackfillDone; $screenshotPage++) {
      $screenshotBackfillText = docker exec $screenshotContainer psql -U postgres -d postgres -Atc 'select public.backfill_journal_screenshots(100)'
      if ($LASTEXITCODE -ne 0) { throw 'Local screenshot backfill failed.' }
      $screenshotBackfill = $screenshotBackfillText | ConvertFrom-Json
      if ($screenshotBackfill.invalid.Count -gt 0) { throw 'Local legacy image inventory found invalid paths. Inspect them before enabling intake.' }
      $screenshotBackfillDone = $screenshotBackfill.done
    }
    if (!$screenshotBackfillDone) { throw 'Local screenshot backfill did not complete within 100,000 objects.' }
    docker exec $screenshotContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "notify pgrst, 'reload schema';"
  }

  $env:SUPABASE_URL = $screenshotApi
  $env:SUPABASE_SERVICE_ROLE_KEY = $screenshotStatus.SERVICE_ROLE_KEY
  $env:NEXT_PUBLIC_SUPABASE_URL = $screenshotApi
  $env:NEXT_PUBLIC_SUPABASE_ANON_KEY = $screenshotStatus.ANON_KEY
  $env:NEXT_PUBLIC_APP_URL = $screenshotApp
  $env:AUTH_SIGNUP_ENABLED = 'true'
  $env:NEXT_PUBLIC_TURNSTILE_SITE_KEY = ''
  $env:NEXT_PUBLIC_JOURNAL_SCREENSHOTS_ENABLED = 'true'
  $env:UPSTASH_REDIS_REST_URL = ''
  $env:UPSTASH_REDIS_REST_TOKEN = ''
  $env:MACROFLOW_ACCOUNT_EVAL = 'true'
  $env:MACROFLOW_BUILD_DIR = '.artifacts/screenshot-eval/next'
  $env:MACROFLOW_SCREENSHOT_TEST_STATUS = $screenshotStatusFile
  node tests/screenshots/seed.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Local screenshot seed failed.' }
  Write-Host "Screenshot evaluator: $screenshotApp. Test status file: $screenshotStatusFile"
  if (!$SetupOnly) {
    if (Get-NetTCPConnection -LocalPort 3004 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 3004 is already occupied. Stop only this evaluator before restarting.' }
    npm run dev -- --port 3004
  }
} finally { Pop-Location }
