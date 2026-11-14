<#
.SYNOPSIS
    One-time setup for Exoplanet Finder on Windows.

.DESCRIPTION
    Checks prerequisites (Python 3.11-3.13, Node.js 20+), creates a Python virtual environment in .venv,
    installs PyTorch (CUDA build if an NVIDIA GPU is detected, otherwise CPU), installs the backend and
    frontend dependencies, creates the data folders, initialises the SQLite database and runs an
    environment self-check.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\setup.ps1
    powershell -ExecutionPolicy Bypass -File .\setup.ps1 -Cpu        # force the CPU build of PyTorch
    powershell -ExecutionPolicy Bypass -File .\setup.ps1 -SkipNetworkCheck
#>
[CmdletBinding()]
param(
    [switch]$Cpu,
    [switch]$SkipNetworkCheck
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    [ok] $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "    [!]  $msg" -ForegroundColor Yellow }
function Fail($msg, $fix) {
    Write-Host "`n[X] $msg" -ForegroundColor Red
    if ($fix) { Write-Host "    How to fix: $fix" -ForegroundColor Yellow }
    exit 1
}

Write-Host ""
Write-Host "  EXOPLANET FINDER - setup" -ForegroundColor Magenta
Write-Host "  ------------------------" -ForegroundColor Magenta

# ------------------------------------------------------------------------------------------------
Write-Step "Checking Python (3.11, 3.12 or 3.13, 64-bit)"
$pyCmd = $null
$candidates = @(
    @('py', '-3.12'), @('py', '-3.11'), @('py', '-3.13'),
    @('python', $null), @('python3', $null)
)
foreach ($c in $candidates) {
    $exe = $c[0]; $arg = $c[1]
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { continue }
    try {
        $argsList = @(); if ($arg) { $argsList += $arg }
        $ver = & $exe @argsList -c "import sys,struct;print('%d.%d %d' % (sys.version_info[0], sys.version_info[1], struct.calcsize('P')*8))" 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $ver) { continue }
        $parts = $ver.Trim().Split(' ')
        $mm = $parts[0]; $bits = $parts[1]
        if ($mm -in @('3.11', '3.12', '3.13') -and $bits -eq '64') {
            $pyCmd = @($exe) + $argsList
            Write-Ok "Found Python $mm ($bits-bit) via '$($pyCmd -join ' ')'"
            break
        }
    } catch { continue }
}
if (-not $pyCmd) {
    Fail "Python 3.11-3.13 (64-bit) was not found." "Install Python 3.12 from https://www.python.org/downloads/windows/ and tick 'Add python.exe to PATH' during installation, then re-run setup."
}

# ------------------------------------------------------------------------------------------------
Write-Step "Checking Node.js (20 or newer)"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "Node.js was not found." "Install the LTS version from https://nodejs.org/ (default options), open a NEW PowerShell window and re-run setup."
}
$nodeVer = (node --version).Trim().TrimStart('v')
$nodeMajor = [int]($nodeVer.Split('.')[0])
if ($nodeMajor -lt 20) { Fail "Node.js $nodeVer is too old (need 20+)." "Install the current LTS from https://nodejs.org/." }
Write-Ok "Found Node.js $nodeVer"
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail "npm was not found." "Reinstall Node.js from https://nodejs.org/ (npm is included)." }

# ------------------------------------------------------------------------------------------------
Write-Step "Creating Python virtual environment (.venv)"
$venvPy = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPy)) {
    $exe = $pyCmd[0]; $rest = @(); if ($pyCmd.Count -gt 1) { $rest = $pyCmd[1..($pyCmd.Count - 1)] }
    & $exe @rest -m venv .venv
    if ($LASTEXITCODE -ne 0) { Fail "Could not create the virtual environment." "Make sure the folder is writable and not inside OneDrive sync conflicts." }
    Write-Ok "Created .venv"
} else {
    Write-Ok ".venv already exists"
}
& $venvPy -m pip install --upgrade pip --quiet
if ($LASTEXITCODE -ne 0) { Fail "pip upgrade failed." "Check your internet connection / proxy and re-run setup." }

# ------------------------------------------------------------------------------------------------
Write-Step "Installing PyTorch"
# find_spec prints nothing: with $ErrorActionPreference = 'Stop', Windows PowerShell 5.1 turns any
# redirected stderr output of a native command (e.g. "No module named torch") into a terminating error.
& $venvPy -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('torch') else 1)"
$hasTorch = ($LASTEXITCODE -eq 0)
if ($hasTorch) {
    Write-Ok "PyTorch already installed"
} else {
    $useCuda = (-not $Cpu) -and [bool](Get-Command nvidia-smi -ErrorAction SilentlyContinue)
    if ($useCuda) {
        Write-Host "    NVIDIA GPU detected - installing the CUDA build (about 2.5 GB download)..."
        & $venvPy -m pip install torch --index-url https://download.pytorch.org/whl/cu126
        if ($LASTEXITCODE -ne 0) {
            Write-Warn2 "CUDA build failed to install - falling back to the CPU build."
            & $venvPy -m pip install torch
        }
    } else {
        Write-Host "    No NVIDIA GPU detected (or -Cpu given) - installing the CPU build..."
        & $venvPy -m pip install torch
    }
    if ($LASTEXITCODE -ne 0) { Fail "PyTorch installation failed." "Check your internet connection and free disk space (needs ~1-3 GB), then re-run setup." }
    Write-Ok "PyTorch installed"
}

# ------------------------------------------------------------------------------------------------
Write-Step "Installing backend dependencies"
& $venvPy -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { Fail "Installing Python requirements failed." "Re-run setup; if it persists, see README 'Troubleshooting'." }
& $venvPy -m pip install -e backend --no-deps --quiet
if ($LASTEXITCODE -ne 0) { Fail "Installing the exofinder backend package failed." "Re-run setup." }
Write-Ok "Backend dependencies installed"

# ------------------------------------------------------------------------------------------------
Write-Step "Installing frontend dependencies (npm)"
Push-Location frontend
try {
    if (Test-Path package-lock.json) { npm ci --no-audit --no-fund } else { npm install --no-audit --no-fund }
    if ($LASTEXITCODE -ne 0) { Fail "npm install failed." "Delete frontend\node_modules and re-run setup." }
} finally { Pop-Location }
Write-Ok "Frontend dependencies installed"

# ------------------------------------------------------------------------------------------------
Write-Step "Configuring environment"
if (-not (Test-Path .env)) { Copy-Item .env.example .env; Write-Ok "Created .env from .env.example" } else { Write-Ok ".env already exists (kept)" }
foreach ($d in @('data', 'artifacts', 'logs', '.run')) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

Write-Step "Initialising database and folders"
& $venvPy -m exofinder.cli init
if ($LASTEXITCODE -ne 0) { Fail "Database initialisation failed." "See the error above; make sure the project folder is writable." }

# ------------------------------------------------------------------------------------------------
Write-Step "Environment self-check"
$doctorArgs = @('-m', 'exofinder.cli', 'doctor')
if ($SkipNetworkCheck) { $doctorArgs += '--no-network' }
& $venvPy @doctorArgs
if ($LASTEXITCODE -ne 0) {
    Write-Warn2 "The self-check reported problems (see above). The app may still start; NASA downloads need internet access."
}

Write-Host ""
Write-Host "  Setup complete." -ForegroundColor Green
Write-Host "  Start the app with:  powershell -ExecutionPolicy Bypass -File .\start.ps1" -ForegroundColor Green
Write-Host ""
