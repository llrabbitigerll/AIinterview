# DevTools Start Script
# Starts: Python backend (port 8000+8001) + Electron frontend + VS Code Extension DevHost
# Usage: .\devtools\start.ps1

param(
    [switch]$NoElectron,
    [switch]$NoVSCode
)

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AI Interview DevTools" -ForegroundColor Cyan
Write-Host "  Main App  -> http://localhost:8000" -ForegroundColor Cyan
Write-Host "  DevTools  -> http://localhost:8001" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Detect Python venv
$VenvPython = "$Root\.venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
    Write-Host "ERROR: .venv not found at $Root\.venv" -ForegroundColor Red
    Write-Host "Create it: python -m venv .venv && .venv\Scripts\Activate.ps1 && pip install -r server\pyproject.toml" -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] Python venv: $VenvPython" -ForegroundColor Green

# 2. Kill existing processes on ports 8000 and 8001
foreach ($port in @(8000, 8001)) {
    $portPids = netstat -ano | Select-String ":$port " | ForEach-Object {
        ($_ -split '\s+')[-1]
    } | Sort-Object -Unique
    foreach ($procId in $portPids) {
        if ($procId -match '^\d+$' -and $procId -ne '0') {
            try {
                Stop-Process -Id ([int]$procId) -Force -ErrorAction SilentlyContinue
                Write-Host "[KILL] PID $procId on port $port" -ForegroundColor Yellow
            } catch {}
        }
    }
}
Start-Sleep -Milliseconds 500

# 3. Start Python backend (both ports)
Write-Host "[START] Python backend..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$Root'; Write-Host '[DevTools] Backend starting...' -ForegroundColor Cyan; & '$VenvPython' -m devtools.server.launcher"
) -WindowStyle Normal

# 4. Wait for both servers using .NET HttpWebRequest (avoids Invoke-WebRequest hangs)
function Test-Port {
    param([string]$Url)
    try {
        $req = [System.Net.HttpWebRequest]::Create($Url)
        $req.Timeout = 1500
        $req.Method = "GET"
        $resp = $req.GetResponse()
        $code = [int]$resp.StatusCode
        $resp.Close()
        return $code -lt 400
    } catch {
        return $false
    }
}

Write-Host "[WAIT] Waiting for servers to start (max 30s)..." -ForegroundColor Yellow
$maxWait = 30
$waited = 0
$mainReady = $false
$devReady = $false

while ($waited -lt $maxWait -and (-not $mainReady -or -not $devReady)) {
    Start-Sleep -Seconds 1
    $waited++

    if (-not $mainReady -and (Test-Port "http://localhost:8000/health")) {
        $mainReady = $true
        Write-Host "[OK] Main app ready (port 8000) after ${waited}s" -ForegroundColor Green
    }

    if (-not $devReady -and (Test-Port "http://localhost:8001/devtools/health")) {
        $devReady = $true
        Write-Host "[OK] DevTools ready (port 8001) after ${waited}s" -ForegroundColor Green
    }
}

if (-not $mainReady) { Write-Host "[WARN] Main app did not respond in ${maxWait}s - continuing anyway" -ForegroundColor Yellow }
if (-not $devReady)  { Write-Host "[WARN] DevTools did not respond in ${maxWait}s - continuing anyway" -ForegroundColor Yellow }

# 5. Start Electron frontend
if (-not $NoElectron) {
    Write-Host "[START] Electron frontend..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList @(
        "-NoExit",
        "-Command",
        "Set-Location '$Root\client'; Write-Host '[DevTools] Frontend starting...' -ForegroundColor Cyan; npm run dev"
    ) -WindowStyle Normal
}

# 6. Always rebuild VS Code extension (ensures latest changes take effect)
$ExtDir      = "$Root\devtools\vscode-extension"
$WebviewDist = "$ExtDir\webview\dist\index.html"
$ExtDist     = "$ExtDir\dist\extension.js"

Write-Host "[BUILD] Building VS Code extension..." -ForegroundColor Cyan

Push-Location $ExtDir
if (-not (Test-Path "node_modules")) {
    Write-Host "  Installing extension dependencies..." -ForegroundColor Yellow
    npm install
}
Push-Location webview
if (-not (Test-Path "node_modules")) {
    Write-Host "  Installing webview dependencies..." -ForegroundColor Yellow
    npm install
}
Write-Host "  Building webview..." -ForegroundColor Yellow
npm run build
Pop-Location
Write-Host "  Building extension TypeScript..." -ForegroundColor Yellow
npx tsc -p tsconfig.json
Pop-Location

Write-Host "[OK] Extension built" -ForegroundColor Green

# 7. Open VS Code extension development host
if (-not $NoVSCode) {
    Write-Host "[START] Opening VS Code Extension Development Host..." -ForegroundColor Cyan
    Start-Process "code" -ArgumentList "--extensionDevelopmentPath=$ExtDir", $Root
    Write-Host "[OK] VS Code extension host opening..." -ForegroundColor Green
    Write-Host "      -> In the new VS Code window: Ctrl+Shift+P" -ForegroundColor Cyan
    Write-Host "      -> Run: AI Interview: Open DevTools Panel" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  DevTools started!" -ForegroundColor Green
Write-Host "  Panel opens in VS Code Extension Host" -ForegroundColor Green
Write-Host "  To stop: .\devtools\stop.ps1" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Green
