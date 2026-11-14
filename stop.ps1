<#
.SYNOPSIS
    Stop Exoplanet Finder (backend and frontend).

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
Set-Location -Path $PSScriptRoot

function Say($msg, $color = 'Gray') { if (-not $Quiet) { Write-Host $msg -ForegroundColor $color } }

$stopped = 0
$pidFile = '.run\pids.json'
if (Test-Path $pidFile) {
    $pids = Get-Content $pidFile -Raw | ConvertFrom-Json
    foreach ($name in @('backend', 'frontend')) {
        $id = $pids.$name
        if ($id -and (Get-Process -Id $id -ErrorAction SilentlyContinue)) {
            # /T kills the whole process tree (npm -> node -> vite)
            taskkill /PID $id /T /F | Out-Null
            Say "  stopped $name (pid $id)" 'Green'
            $stopped++
        }
    }
    Remove-Item $pidFile -Force
}

# Fallback: free the ports if something is still listening
foreach ($port in @($BackendPort, $FrontendPort)) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        $procId = $c.OwningProcess
        if ($procId -and $procId -ne 0) {
            taskkill /PID $procId /T /F | Out-Null
            Say "  freed port $port (pid $procId)" 'Green'
            $stopped++
        }
    }
}

if ($stopped -eq 0) { Say "  Exoplanet Finder was not running." 'DarkGray' } else { Say "  Exoplanet Finder stopped." 'Green' }
