<#
.SYNOPSIS
    Start Exoplanet Finder (backend on :8000, frontend on :5173) and open the browser.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\start.ps1
    powershell -ExecutionPolicy Bypass -File .\start.ps1 -NoBrowser
    powershell -ExecutionPolicy Bypass -File .\start.ps1 -BackendPort 8010   # if port 8000 is taken
#>
[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173,
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # Invoke-WebRequest progress bars flicker and slow PS 5.1 down
Set-Location -LiteralPath $PSScriptRoot

$venvPy = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPy)) {
    Write-Host "[X] Setup has not been run yet." -ForegroundColor Red
    Write-Host "    Run: powershell -ExecutionPolicy Bypass -File .\setup.ps1" -ForegroundColor Yellow
    exit 1
}
if (-not (Test-Path -LiteralPath 'frontend\node_modules')) {
    Write-Host "[X] Frontend dependencies are missing. Re-run setup.ps1." -ForegroundColor Red
    exit 1
}

function Test-PortInUse([int]$port) {
    try {
        $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
        return [bool]$c
    } catch { return $false }
}
foreach ($p in @($BackendPort, $FrontendPort)) {
    if (Test-PortInUse $p) {
        Write-Host "[X] Port $p is already in use (Exoplanet Finder may already be running)." -ForegroundColor Red
        Write-Host "    Run .\stop.ps1 first, or close the program using port $p." -ForegroundColor Yellow
        exit 1
    }
}

New-Item -ItemType Directory -Force -Path logs, .run | Out-Null
# Both servers read standard input from this empty file. Otherwise they would inherit this console's
# input although they run in their own hidden window, and Vite would bind its keyboard shortcuts
# ("q" + Enter quits) to the PowerShell window you keep typing in.
$noInput = Join-Path $PSScriptRoot '.run\stdin.empty'
if (-not (Test-Path -LiteralPath $noInput)) { New-Item -ItemType File -Path $noInput | Out-Null }

Write-Host ""
Write-Host "  EXOPLANET FINDER" -ForegroundColor Magenta
Write-Host "  Starting backend  -> http://localhost:$BackendPort" -ForegroundColor Cyan
# UTF-8 mode: log files are written as UTF-8 instead of the ANSI code page (cp1252), so log lines
# with non-ASCII characters (paths, names) cannot fail to encode. Inherited by dataset-build workers.
$env:PYTHONUTF8 = '1'
$backend = Start-Process -FilePath $venvPy `
    -ArgumentList @('-m', 'uvicorn', 'exofinder.api.main:app', '--host', '127.0.0.1', '--port', "$BackendPort") `
    -WorkingDirectory (Join-Path $PSScriptRoot 'backend') `
    -RedirectStandardInput $noInput `
    -RedirectStandardOutput (Join-Path $PSScriptRoot 'logs\backend.out.log') `
    -RedirectStandardError (Join-Path $PSScriptRoot 'logs\backend.log') `
    -WindowStyle Hidden -PassThru

Write-Host "  Starting frontend -> http://localhost:$FrontendPort" -ForegroundColor Cyan
# The Vite dev server proxies /api to this URL (frontend/vite.config.ts reads VITE_API_URL).
# 127.0.0.1, not localhost: Node may resolve localhost to the IPv6 address ::1 on Windows.
$env:VITE_API_URL = "http://127.0.0.1:$BackendPort"
# cmd.exe runs npm.cmd: no dependency on the PowerShell execution policy (npm.ps1).
$frontend = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList @('/c', "npm run dev -- --port $FrontendPort --strictPort") `
    -WorkingDirectory (Join-Path $PSScriptRoot 'frontend') `
    -RedirectStandardInput $noInput `
    -RedirectStandardOutput (Join-Path $PSScriptRoot 'logs\frontend.log') `
    -RedirectStandardError (Join-Path $PSScriptRoot 'logs\frontend.err.log') `
    -WindowStyle Hidden -PassThru

@{ backend = $backend.Id; frontend = $frontend.Id; started = (Get-Date).ToString('s') } |
    ConvertTo-Json | Set-Content -Path '.run\pids.json' -Encoding UTF8

function Wait-Url([string]$url, [string]$name, $proc) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($proc.HasExited) { return $false }
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
        } catch { }
        Start-Sleep -Milliseconds 700
    }
    return $false
}

function Stop-App { & (Join-Path $PSScriptRoot 'stop.ps1') -Quiet -BackendPort $BackendPort -FrontendPort $FrontendPort }

Write-Host "  Waiting for services to become ready..." -ForegroundColor DarkGray
$okBackend = Wait-Url "http://127.0.0.1:$BackendPort/api/health" 'backend' $backend
if (-not $okBackend) {
    Write-Host "[X] The backend did not start. Last lines of logs\backend.log:" -ForegroundColor Red
    if (Test-Path 'logs\backend.log') { Get-Content 'logs\backend.log' -Tail 25 -Encoding UTF8 }
    Stop-App
    exit 1
}
Write-Host "    [ok] backend ready" -ForegroundColor Green
$okFrontend = Wait-Url "http://localhost:$FrontendPort/" 'frontend' $frontend
if (-not $okFrontend) {
    Write-Host "[X] The frontend did not start. Last lines of logs\frontend.log:" -ForegroundColor Red
    if (Test-Path 'logs\frontend.log') { Get-Content 'logs\frontend.log' -Tail 25 -Encoding UTF8 }
    if (Test-Path 'logs\frontend.err.log') { Get-Content 'logs\frontend.err.log' -Tail 25 -Encoding UTF8 }
    Stop-App
    exit 1
}
Write-Host "    [ok] frontend ready" -ForegroundColor Green

Write-Host ""
Write-Host "  App:      http://localhost:$FrontendPort" -ForegroundColor Green
Write-Host "  API:      http://localhost:$BackendPort" -ForegroundColor Green
Write-Host "  API docs: http://localhost:$BackendPort/docs" -ForegroundColor Green
Write-Host "  Logs:     .\logs\" -ForegroundColor DarkGray
Write-Host "  Stop:     powershell -ExecutionPolicy Bypass -File .\stop.ps1" -ForegroundColor DarkGray
Write-Host ""
if (-not $NoBrowser) { Start-Process "http://localhost:$FrontendPort" }
