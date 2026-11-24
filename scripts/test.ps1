<#
.SYNOPSIS
    Run the Exoplanet Finder test suites on Windows.

.DESCRIPTION
    Runs the backend tests (pytest, offline), the frontend type check and unit tests (Vitest) and,
    unless -SkipE2E is given, the Playwright end-to-end tests. Use -Network to also run the live
    NASA checks (they need an internet connection).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1
    powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1 -SkipE2E
    powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1 -Network
#>
[CmdletBinding()]
param(
    [switch]$SkipE2E,
    [switch]$Network
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    Write-Host "[X] .venv not found. Run setup.ps1 first." -ForegroundColor Red
    exit 1
}

# Test tools (pytest, ruff) are not part of the runtime setup: install them on first use.
& $python -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('pytest') else 1)"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing test tools (requirements-dev.txt)..." -ForegroundColor Cyan
    & $python -m pip install -q -r (Join-Path $root 'requirements-dev.txt')
}

$results = [ordered]@{}
function Invoke-Suite($name, [scriptblock]$block) {
    Write-Host "`n==> $name" -ForegroundColor Cyan
    & $block
    $ok = ($LASTEXITCODE -eq 0)
    $results[$name] = $(if ($ok) { 'passed' } else { "FAILED (exit $LASTEXITCODE)" })
}

Push-Location (Join-Path $root 'backend')
try {
    Invoke-Suite 'Backend tests (pytest)' { & $python -m pytest -q }
    if ($Network) {
        Invoke-Suite 'Backend live NASA checks (pytest -m network)' { & $python -m pytest -q -m network }
    }
} finally { Pop-Location }

Push-Location (Join-Path $root 'frontend')
try {
    Invoke-Suite 'Frontend type check' { cmd /c npm run typecheck }
    Invoke-Suite 'Frontend unit tests (Vitest)' { cmd /c npm test }
    if (-not $SkipE2E) {
        Invoke-Suite 'Playwright browser install' { cmd /c npx playwright install chromium }
        Invoke-Suite 'End-to-end tests (Playwright)' { cmd /c npm run test:e2e }
    }
} finally { Pop-Location }

Write-Host "`nSummary" -ForegroundColor Magenta
$failed = $false
foreach ($k in $results.Keys) {
    $v = $results[$k]
    $color = $(if ($v -eq 'passed') { 'Green' } else { 'Red' })
    if ($v -ne 'passed') { $failed = $true }
    Write-Host ("  {0,-48} {1}" -f $k, $v) -ForegroundColor $color
}
if ($failed) { exit 1 } else { exit 0 }
