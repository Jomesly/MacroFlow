param([switch]$SetupOnly, [switch]$ReleaseEvaluation)

$ErrorActionPreference = 'Stop'
$taskRepo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskProject = if ($ReleaseEvaluation) { 'macroflow-account-release' } else { 'macroflow-account-eval' }
$taskPortPrefix = if ($ReleaseEvaluation) { '556' } else { '554' }
$taskAppPort = if ($ReleaseEvaluation) { 3002 } else { 3001 }
$taskEvalRoot = Join-Path $env:TEMP $taskProject
$taskContainer = "supabase_db_$taskProject"
New-Item -ItemType Directory -Force -Path (Join-Path $taskEvalRoot 'supabase/templates') | Out-Null
$taskConfig = (Get-Content (Join-Path $taskRepo 'supabase/auth-test.config.toml') -Raw).Replace('macroflow-auth-tests',$taskProject).Replace('553',$taskPortPrefix).Replace('3137',"$taskAppPort").Replace('jwt_expiry = 300','jwt_expiry = 3600')
Set-Content -LiteralPath (Join-Path $taskEvalRoot 'supabase/config.toml') -Value $taskConfig -Encoding utf8
Copy-Item -Path (Join-Path $taskRepo 'supabase/templates/*.html') -Destination (Join-Path $taskEvalRoot 'supabase/templates')
Push-Location $taskRepo
try {
  $ErrorActionPreference = 'Continue'
  npx --yes supabase start --workdir $taskEvalRoot --exclude storage-api,imgproxy,studio,postgres-meta,realtime,edge-runtime,logflare,vector,supavisor *> (Join-Path $taskEvalRoot 'supabase-start.log')
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) { throw "Local Supabase startup failed. See $taskEvalRoot/supabase-start.log." }
  $ErrorActionPreference = 'Continue'
  $taskStatusText = npx --yes supabase status --workdir $taskEvalRoot -o json 2> (Join-Path $taskEvalRoot 'supabase-status.log')
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) { throw 'Could not read local Supabase status.' }
  $taskStatusText | Set-Content -LiteralPath (Join-Path $taskEvalRoot 'status.json') -Encoding utf8
  $taskStatus = $taskStatusText | ConvertFrom-Json
  if ($taskStatus.API_URL -ne "http://127.0.0.1:${taskPortPrefix}21") { throw 'Unexpected evaluation project URL.' }
  docker exec $taskContainer mkdir -p /tmp/macroflow-sql
  docker cp (Join-Path $taskRepo 'supabase/.') "${taskContainer}:/tmp/macroflow-sql"
  if ($LASTEXITCODE -ne 0) { throw 'Could not copy local migration files.' }
  $taskHasSchema = docker exec $taskContainer psql -U postgres -d postgres -Atc "select to_regclass('public.trades') is not null"
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the local database.' }
  if ($taskHasSchema -eq 'f') {
    docker exec $taskContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/macroflow-sql/schema.sql -f /tmp/macroflow-sql/subscribers.sql -f /tmp/macroflow-sql/journal-autosync.sql -f /tmp/macroflow-sql/signup-login.sql
    if ($LASTEXITCODE -ne 0) { throw 'Local base schema migration failed.' }
  }
  $taskHasJournal = docker exec $taskContainer psql -U postgres -d postgres -Atc "select to_regclass('public.journal_accounts') is not null"
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the local journal schema.' }
  if ($taskHasJournal -eq 'f') {
    docker exec $taskContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/macroflow-sql/trading-accounts.sql -f /tmp/macroflow-sql/journal-account-funds.sql -f /tmp/macroflow-sql/journal-imports.sql
    if ($LASTEXITCODE -ne 0) { throw 'Local production journal migrations failed.' }
  }
  $taskHasAccounts = docker exec $taskContainer psql -U postgres -d postgres -Atc "select exists (select 1 from information_schema.columns where table_schema='public' and table_name='broker_accounts' and column_name='lifecycle')"
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect account migration state.' }
  if ($taskHasAccounts -eq 'f') {
    docker exec $taskContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/macroflow-sql/account-management.sql
    if ($LASTEXITCODE -ne 0) { throw 'Local account-management migration failed.' }
  }
  docker exec $taskContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/macroflow-sql/account-management-hardening.sql
  if ($LASTEXITCODE -ne 0) { throw 'Local account hardening migration failed.' }
  docker exec $taskContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/macroflow-sql/account-management-journal-compat.sql
  if ($LASTEXITCODE -ne 0) { throw 'Local journal compatibility migration failed.' }
  $env:SUPABASE_URL = $taskStatus.API_URL
  $env:SUPABASE_SERVICE_ROLE_KEY = $taskStatus.SERVICE_ROLE_KEY
  $env:NEXT_PUBLIC_SUPABASE_URL = $taskStatus.API_URL
  $env:NEXT_PUBLIC_SUPABASE_ANON_KEY = $taskStatus.ANON_KEY
  $env:NEXT_PUBLIC_APP_URL = "http://localhost:$taskAppPort"
  $env:AUTH_SIGNUP_ENABLED = 'true'
  $env:NEXT_PUBLIC_TURNSTILE_SITE_KEY = ''
  $env:NEXT_PUBLIC_JOURNAL_SCREENSHOTS_ENABLED = ''
  $env:UPSTASH_REDIS_REST_URL = ''
  $env:UPSTASH_REDIS_REST_TOKEN = ''
  $env:MACROFLOW_ACCOUNT_EVAL = 'true'
  node scripts/seed-account-eval.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Local evaluation seed failed.' }
  if (!$SetupOnly) {
    if (Get-NetTCPConnection -LocalPort $taskAppPort -State Listen -ErrorAction SilentlyContinue) { throw "Port $taskAppPort is already occupied. The local database is ready; stop the existing evaluation app before restarting." }
    Write-Host "Open http://localhost:$taskAppPort/login. Hosted credentials and data were not changed."
    npm run dev -- --port $taskAppPort
  }
} finally { Pop-Location }
