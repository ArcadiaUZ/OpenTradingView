$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Python interpreter: MT5_PYTHON env var > "python" on PATH
$Py = $env:MT5_PYTHON
if (-not $Py) {
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if ($cmd) { $Py = $cmd.Source } else { $Py = "python" }
}

Write-Host "Starting MT5 API on http://127.0.0.1:8787 ..." -ForegroundColor Cyan
Start-Process -FilePath $Py -ArgumentList @("-m","uvicorn","main:app","--host","127.0.0.1","--port","8787") -WorkingDirectory "$Root\backend" -WindowStyle Minimized

Start-Sleep -Seconds 3
Write-Host "Starting UI on http://127.0.0.1:5173 ..." -ForegroundColor Cyan
Start-Process -FilePath "npm.cmd" -ArgumentList @("run","dev") -WorkingDirectory "$Root\frontend" -WindowStyle Minimized

Start-Sleep -Seconds 6
Start-Process "http://127.0.0.1:5173"
Write-Host "Done. Keep both windows open; MT5 terminal must stay logged in." -ForegroundColor Green
