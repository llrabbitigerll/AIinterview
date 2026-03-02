# DevTools Stop Script — kills all devtools processes
# Usage: .\devtools\stop.ps1 (from repo root d:\APP)

Write-Host "Stopping DevTools..." -ForegroundColor Yellow

foreach ($port in @(8000, 8001)) {
    $portPids = netstat -ano | Select-String ":$port " | ForEach-Object {
        ($_ -split '\s+')[-1]
    } | Sort-Object -Unique
    foreach ($procId in $portPids) {
        if ($procId -match '^\d+$' -and $procId -ne '0') {
            try {
                Stop-Process -Id ([int]$procId) -Force -ErrorAction SilentlyContinue
                Write-Host "  Killed PID $procId (port $port)" -ForegroundColor Green
            } catch {}
        }
    }
}

Write-Host "DevTools stopped." -ForegroundColor Green
Write-Host "Note: Electron frontend window may need to be closed manually." -ForegroundColor Yellow
