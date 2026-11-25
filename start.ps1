$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Resolve a Python interpreter that actually has MetaTrader5 installed.
# 1) MT5_PYTHON env var  2) "py -3" launcher  3) python / python3 on PATH
function Test-Python([string]$exe, [string[]]$pre) {
  if (-not $exe) { return $false }
  try {
    & $exe @pre -c "import MetaTrader5" 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
  } catch { return $false }
}

$pyExe = $null
$pyPre = @()
if ($env:MT5_PYTHON) {
  $pyExe = $env:MT5_PYTHON
} elseif (Test-Python "py" @("-3")) {
  $pyExe = "py"; $pyPre = @("-3")
} elseif (Test-Python "python" @()) {
  $pyExe = "python"
} elseif (Test-Python "python3" @()) {
  $pyExe = "python3"
}

if (-not $pyExe) {
  Write-Host "No usable Python found (needs MetaTrader5, fastapi, uvicorn)." -ForegroundColor Red
  Write-Host "Install them, or set MT5_PYTHON to your python.exe, e.g.:" -ForegroundColor Yellow
  Write-Host '  $env:MT5_PYTHON = "C:\Python312\python.exe"' -ForegroundColor Yellow
  Write-Host "Then run start.bat again." -ForegroundColor Yellow
  Read-Host "Press Enter to close"
  exit 1
}

Write-Host ("Python: " + $pyExe + " " + ($pyPre -join " ")) -ForegroundColor DarkGray
Write-Host "Starting MT5 API on http://127.0.0.1:8787 ..." -ForegroundColor Cyan
Start-Process -FilePath $pyExe -ArgumentList (@($pyPre) + @("-m","uvicorn","main:app","--host","127.0.0.1","--port","8787")) -WorkingDirectory "$Root\backend" -WindowStyle Minimized

Start-Sleep -Seconds 3
Write-Host "Starting UI on http://127.0.0.1:5173 ..." -ForegroundColor Cyan
Start-Process -FilePath "npm.cmd" -ArgumentList @("run","dev") -WorkingDirectory "$Root\frontend" -WindowStyle Minimized

Start-Sleep -Seconds 6
Start-Process "http://127.0.0.1:5173"
Write-Host "Done. Keep both windows open; MT5 terminal must stay logged in." -ForegroundColor Green
