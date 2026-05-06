# Start the Factory Governor
$env:PYTHONIOENCODING = "utf-8"
$interval = if ($args[0]) { $args[0] } else { 180 }
Write-Host "Factory Governor starting (poll every ${interval}s)..."
python "$PSScriptRoot\governor.py" --interval $interval
