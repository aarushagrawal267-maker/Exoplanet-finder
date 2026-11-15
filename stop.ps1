<#
.SYNOPSIS
    Stop Exoplanet Finder (backend and frontend).

.DESCRIPTION
    Stops the processes that start.ps1 recorded in .run\pids.json, after checking that each one is
    still an Exoplanet Finder process: Windows re-uses process ids, so after a restart or a crash the
    recorded id may belong to an unrelated program. If the pid file is missing, the backend/frontend
    ports are freed only when the program listening there is ours (uvicorn exofinder, or the Vite
    server of this project's frontend folder); anything else is left alone and reported.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\stop.ps1
#>
[CmdletBinding()]
param(
    [switch]$Quiet,
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173
)

$ErrorActionPreference = 'SilentlyContinue'
Set-Location -LiteralPath $PSScriptRoot
$frontendDir = (Join-Path $PSScriptRoot 'frontend').ToLowerInvariant()

function Say($msg, $color = 'Gray') { if (-not $Quiet) { Write-Host $msg -ForegroundColor $color } }

function Get-CommandLine([int]$procId) {
    # Empty for processes that no longer exist or that belong to another user / an elevated session.
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
    if ($p -and $p.CommandLine) { return ([string]$p.CommandLine).ToLowerInvariant() }
    return ''
}

function Test-OurProcess([int]$procId, [string]$role) {
    $cmd = Get-CommandLine $procId
    if (-not $cmd) { return $false }
    if ($role -eq 'backend') { return $cmd.Contains('exofinder') }
    # frontend: the "cmd /c npm run dev" that start.ps1 launched, or Vite running from our folder
    return ($cmd.Contains('npm run dev') -or ($cmd.Contains('vite') -and $cmd.Contains($frontendDir)))
}

function Stop-Tree([int]$procId) {
    # /T: the whole tree (venv launcher -> python -> dataset workers; cmd -> npm -> node/vite).
    # /F is required: console programs without a window cannot be asked to close.
    & taskkill.exe /PID $procId /T /F 2>&1 | Out-Null
}

$stopped = 0
$pidFile = '.run\pids.json'
if (Test-Path -LiteralPath $pidFile) {
    $pids = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
    foreach ($name in @('backend', 'frontend')) {
        $id = $pids.$name
        if (-not $id -or -not (Get-Process -Id $id -ErrorAction SilentlyContinue)) { continue }
        if (Test-OurProcess $id $name) {
            Stop-Tree $id
            Say "  stopped $name (pid $id)" 'Green'
            $stopped++
        } else {
            Say "  pid $id from .run\pids.json is now another program (not Exoplanet Finder) - not stopped" 'Yellow'
        }
    }
    Remove-Item -LiteralPath $pidFile -Force
    if ($stopped -gt 0) { Start-Sleep -Milliseconds 500 }  # let the listening sockets close
}

# Fallback: free the ports if one of OUR processes is still listening (e.g. the pid file was lost).
foreach ($port in @(@{ Port = $BackendPort; Role = 'backend' }, @{ Port = $FrontendPort; Role = 'frontend' })) {
    $owners = Get-NetTCPConnection -LocalPort $port.Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $owners) {
        if (-not $procId -or $procId -eq 0) { continue }
        if (-not (Get-Process -Id $procId -ErrorAction SilentlyContinue)) { continue }  # just exited
        if (Test-OurProcess $procId $port.Role) {
            Stop-Tree $procId
            Say "  freed port $($port.Port) (pid $procId)" 'Green'
            $stopped++
        } else {
            Say "  port $($port.Port) is used by another program (pid $procId) - not stopped" 'Yellow'
        }
    }
}

if ($stopped -eq 0) { Say "  Exoplanet Finder was not running." 'DarkGray' } else { Say "  Exoplanet Finder stopped." 'Green' }
