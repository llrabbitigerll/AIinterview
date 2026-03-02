# AI Interview - Start Script
# Usage: .\start.ps1

$ROOT        = Split-Path -Parent $MyInvocation.MyCommand.Path
$VENV_PYTHON = "$ROOT\.venv\Scripts\python.exe"
$SERVER_DIR  = "$ROOT\server"
$CLIENT_DIR  = "$ROOT\client"

# Check venv
if (-not (Test-Path $VENV_PYTHON)) {
    Write-Host "[ERROR] venv not found: $VENV_PYTHON" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Kill existing processes on port 8000
$old = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if ($old) {
    Write-Host "[INFO] Killing old server processes on port 8000..." -ForegroundColor Yellow
    $old | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    Start-Sleep 1
}

# Start backend server in a new window
Write-Host "[INFO] Starting backend server (http://localhost:8000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$SERVER_DIR'; & '$VENV_PYTHON' -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --log-level info"
) -WindowStyle Normal

# Wait for server to be ready
Write-Host "[INFO] Waiting for server..." -ForegroundColor Cyan
$maxWait = 15
$waited  = 0
do {
    Start-Sleep 1
    $waited++
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { break }
    } catch { }
} while ($waited -lt $maxWait)

if ($waited -ge $maxWait) {
    Write-Host "[WARN] Server did not respond within ${maxWait}s, continuing anyway..." -ForegroundColor Yellow
} else {
    Write-Host "[OK]  Server ready in ${waited}s" -ForegroundColor Green
}

# Start Electron client in a new window
Write-Host "[INFO] Pre-building Electron main process..." -ForegroundColor Cyan
Push-Location $CLIENT_DIR
npx tsc -p tsconfig.main.json 2>&1 | Out-Null
Pop-Location
Write-Host "[OK]  Main process compiled" -ForegroundColor Green

Write-Host "[INFO] Starting Electron client..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$CLIENT_DIR'; npm run dev"
) -WindowStyle Normal

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Green
Write-Host "  Started!" -ForegroundColor Green
Write-Host "  Backend : http://localhost:8000" -ForegroundColor Green
Write-Host "  Frontend: Electron window will open automatically" -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Green
Write-Host "Close the two PowerShell windows to stop." -ForegroundColor Gray
