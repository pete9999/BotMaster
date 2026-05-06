$port = 9100

# Kill by port
$conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
foreach ($c in $conns) {
    $p = $c.OwningProcess
    Write-Host "Killing PID $p on port $port..."
    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
}

# Also kill any stray uvicorn/python processes running main:app
Get-WmiObject Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*uvicorn*main:app*' } |
    ForEach-Object { Write-Host "Killing stray uvicorn PID $($_.ProcessId)..."; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if ($conns -or $true) { Start-Sleep -Milliseconds 600 }

Write-Host ""
Write-Host "  Factory Hub → http://localhost:$port"
Write-Host "  Press Ctrl+C to stop"
Write-Host ""
Set-Location $PSScriptRoot
& "$PSScriptRoot\.venv\Scripts\python.exe" -m uvicorn main:app --port $port --reload
