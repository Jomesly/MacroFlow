param([switch]$KeepServices, [string]$TestPattern, [switch]$WithTurnstile)

$ErrorActionPreference = 'Stop'
$taskRepo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskWorkspace = Join-Path $env:TEMP 'macroflow-auth-tests'
$taskProjectId = 'macroflow-auth-tests'
$taskServer = $null
$taskStarted = $false
$taskEnvNames = @('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_APP_URL', 'AUTH_SIGNUP_ENABLED', 'NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'NEXT_PUBLIC_JOURNAL_SCREENSHOTS_ENABLED', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'MACROFLOW_AUTH_TEST_STATUS', 'MACROFLOW_AUTH_TEST_MODE')
$taskPreviousEnv = @{}
foreach ($taskName in $taskEnvNames) { $taskPreviousEnv[$taskName] = [Environment]::GetEnvironmentVariable($taskName, 'Process') }

Push-Location $taskRepo
try {
  if (Get-NetTCPConnection -LocalPort 3137 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 3137 is already in use. Stop that server before starting the isolated auth tests.'
  }
  foreach ($taskPort in @(55321, 55322, 55324)) {
    if (Get-NetTCPConnection -LocalPort $taskPort -State Listen -ErrorAction SilentlyContinue) {
      # A previous run of THIS exact disposable project may still be running.
      $taskContainer = docker ps --filter "name=supabase_db_$taskProjectId" --format '{{.Names}}'
      if ($taskContainer -ne "supabase_db_$taskProjectId") { throw "Port $taskPort belongs to another service. Stop it before running auth tests." }
    }
  }
  New-Item -ItemType Directory -Force -Path (Join-Path $taskWorkspace 'supabase/templates') | Out-Null
  Copy-Item -LiteralPath (Join-Path $taskRepo 'supabase/auth-test.config.toml') -Destination (Join-Path $taskWorkspace 'supabase/config.toml')
  Copy-Item -Path (Join-Path $taskRepo 'supabase/templates/*.html') -Destination (Join-Path $taskWorkspace 'supabase/templates')
  $ErrorActionPreference = 'Continue' # Windows PowerShell treats native stderr warnings as errors.
  npx --yes supabase start --workdir $taskWorkspace --exclude imgproxy,studio,postgres-meta,realtime,edge-runtime,logflare,vector,supavisor *> (Join-Path $taskWorkspace 'supabase-start.log')
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) { throw "Local Supabase startup failed. See $taskWorkspace/supabase-start.log." }
  $taskStarted = $true
  # Explicit --local and a dedicated unlinked temp project: never resets hosted data.
  $ErrorActionPreference = 'Continue'
  npx --yes supabase db reset --local --workdir $taskWorkspace *> (Join-Path $taskWorkspace 'supabase-reset.log')
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) { throw "Local reset failed. See $taskWorkspace/supabase-reset.log." }
  docker exec "supabase_db_$taskProjectId" mkdir -p /tmp/macroflow-sql
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the disposable SQL directory.' }
  docker cp (Join-Path $taskRepo 'supabase/.') "supabase_db_${taskProjectId}:/tmp/macroflow-sql"
  if ($LASTEXITCODE -ne 0) { throw 'Could not copy test SQL into the disposable database container.' }
  $ErrorActionPreference = 'Continue'
  docker exec "supabase_db_$taskProjectId" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/macroflow-sql/schema.sql -f /tmp/macroflow-sql/subscribers.sql -f /tmp/macroflow-sql/journal-autosync.sql -f /tmp/macroflow-sql/tests/signup-login.sql *> (Join-Path $taskWorkspace 'migration-tests.log')
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) { throw "Migration assertions failed. See $taskWorkspace/migration-tests.log." }
  # DROP POLICY IF EXISTS emits a harmless stderr NOTICE on a fresh database.
  $ErrorActionPreference = 'Continue'
  docker exec "supabase_db_$taskProjectId" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/macroflow-sql/journal-screenshots.sql *> (Join-Path $taskWorkspace 'screenshot-migration.log')
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) { throw 'Screenshot bucket migration failed in the disposable database.' }
  $ErrorActionPreference = 'Continue' # Fresh-schema DROP IF EXISTS notices are harmless stderr.
  docker exec "supabase_db_$taskProjectId" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/macroflow-sql/tests/trading-accounts.sql *> (Join-Path $taskWorkspace 'trading-accounts-migration.log')
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) { throw 'Trading accounts migration failed in the disposable database.' }
  $ErrorActionPreference = 'Continue'
  docker exec "supabase_db_$taskProjectId" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/macroflow-sql/journal-account-funds.sql -f /tmp/macroflow-sql/journal-account-funds.sql -f /tmp/macroflow-sql/tests/journal-account-funds.sql *> (Join-Path $taskWorkspace 'journal-funds-migration.log')
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) { throw 'Multi-account trades and funds assertions failed in the disposable database.' }
  $ErrorActionPreference = 'Continue'
  docker exec "supabase_db_$taskProjectId" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/macroflow-sql/journal-imports.sql -f /tmp/macroflow-sql/journal-imports.sql *> (Join-Path $taskWorkspace 'journal-imports-migration.log')
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) { throw 'Journal imports migration failed. See journal-imports-migration.log.' }
  Write-Host 'Migration, backfill, rerun and trigger rollback assertions passed.'
  $ErrorActionPreference = 'Continue'
  $taskStatusText = npx --yes supabase status --workdir $taskWorkspace -o json 2> (Join-Path $taskWorkspace 'supabase-status.log')
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) { throw 'Could not read the isolated Supabase status.' }
  $taskStatusPath = Join-Path $taskWorkspace 'status.json'
  $taskStatusText | Set-Content -LiteralPath $taskStatusPath -Encoding utf8
  $taskStatus = $taskStatusText | ConvertFrom-Json
  if ($taskStatus.API_URL -ne 'http://127.0.0.1:55321') { throw 'Unexpected local API URL; refusing to test.' }
  $env:SUPABASE_URL = $taskStatus.API_URL
  $env:SUPABASE_SERVICE_ROLE_KEY = $taskStatus.SERVICE_ROLE_KEY
  $env:NEXT_PUBLIC_SUPABASE_URL = $taskStatus.API_URL
  $env:NEXT_PUBLIC_SUPABASE_ANON_KEY = $taskStatus.ANON_KEY
  $env:NEXT_PUBLIC_APP_URL = 'http://localhost:3137'
  $env:AUTH_SIGNUP_ENABLED = 'true'
  # The disposable Auth project has CAPTCHA disabled; override .env.local too.
  $env:NEXT_PUBLIC_TURNSTILE_SITE_KEY = if ($WithTurnstile) { '1x00000000000000000000AA' } else { '' }
  $env:UPSTASH_REDIS_REST_URL = ''
  $env:UPSTASH_REDIS_REST_TOKEN = ''
  $env:MACROFLOW_AUTH_TEST_STATUS = $taskStatusPath
  $env:MACROFLOW_AUTH_TEST_MODE = 'true'
  $env:NEXT_PUBLIC_JOURNAL_SCREENSHOTS_ENABLED = 'true'
  npx playwright install chromium
  if ($LASTEXITCODE -ne 0) { throw 'Chromium installation failed.' }
  $taskNext = Join-Path $taskRepo 'node_modules/next/dist/bin/next'
  $taskServer = Start-Process -WindowStyle Hidden -PassThru -FilePath (Get-Command node).Source -ArgumentList @(('"{0}"' -f $taskNext), 'dev', '--port', '3137') -WorkingDirectory $taskRepo -RedirectStandardOutput (Join-Path $taskWorkspace 'next.log') -RedirectStandardError (Join-Path $taskWorkspace 'next-error.log')
  $taskReady = $false
  for ($taskAttempt = 0; $taskAttempt -lt 90; $taskAttempt++) {
    if ($taskServer.HasExited) { throw "Auth test server exited. See $taskWorkspace/next-error.log." }
    try {
      $taskResponse = Invoke-WebRequest 'http://localhost:3137/signup' -UseBasicParsing -TimeoutSec 2
      if ($taskResponse.StatusCode -eq 200) { $taskReady = $true; break }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if (!$taskReady) { throw 'Auth test server did not become ready.' }
  if ($TestPattern) { npx playwright test --grep $TestPattern }
  else { npx playwright test }
  if ($LASTEXITCODE -ne 0) { throw 'Auth browser integration tests failed.' }
} finally {
  if ($taskServer -and !$taskServer.HasExited) { taskkill /PID $taskServer.Id /T /F | Out-Null }
  if ($taskStarted -and !$KeepServices) {
    $ErrorActionPreference = 'Continue'
    npx --yes supabase stop --workdir $taskWorkspace *> (Join-Path $taskWorkspace 'supabase-stop.log')
    $ErrorActionPreference = 'Stop'
  }
  foreach ($taskName in $taskEnvNames) { [Environment]::SetEnvironmentVariable($taskName, $taskPreviousEnv[$taskName], 'Process') }
  Pop-Location
}
