Set-Location $PSScriptRoot
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Cyan
    npm install
}
Write-Host "Starting Factory UI on http://localhost:9200" -ForegroundColor Green
npm run dev
