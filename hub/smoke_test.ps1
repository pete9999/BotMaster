# Smoke test: create project/mission/task, spawn ollama bot, verify completion
# Usage: .\smoke_test.ps1
# Prerequisites: hub on :9100, ollama running with qwen3-coder:latest

$ErrorActionPreference = 'Stop'
$HUB = 'http://localhost:9100'
$PROJ_DIR = 'D:\Dev\Pete.ai.work\Projects\smoke-test-e2e'

function Assert($cond, $msg) { if (-not $cond) { Write-Host "FAIL: $msg" -ForegroundColor Red; exit 1 } }
function Ok($msg) { Write-Host "  OK  $msg" -ForegroundColor Green }

Write-Host "`nBotMaster E2E Smoke Test" -ForegroundColor Cyan

# --- Setup ---
$ts = [int][System.DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$proj_path = "$PROJ_DIR-$ts"
New-Item -ItemType Directory -Path $proj_path -Force | Out-Null

# 1. Create project
$p = Invoke-RestMethod -Uri "$HUB/api/projects" -Method Post -ContentType 'application/json' `
  -Body "{`"name`":`"smoke-e2e-$ts`",`"project_path`":`"$($proj_path.Replace('\','/'))`",`"description`":`"Smoke test`",`"folder_mode`":`"existing`"}"
Assert ($p.id -and $p.project_path) "Project creation failed"
Ok "Project $($p.id) at $($p.project_path)"

# 2. Create mission
$m = Invoke-RestMethod -Uri "$HUB/api/missions" -Method Post -ContentType 'application/json' `
  -Body "{`"project_id`":`"$($p.id)`",`"name`":`"Smoke test mission`",`"stage`":`"approved`"}"
Assert $m.id "Mission creation failed"
Ok "Mission $($m.id)"

# 3. Create task
$t = Invoke-RestMethod -Uri "$HUB/api/tasks" -Method Post -ContentType 'application/json' `
  -Body "{`"project_id`":`"$($p.id)`",`"mission_id`":`"$($m.id)`",`"title`":`"Create hello.py`",`"description`":`"Create a file called hello.py containing: print('hello world')`",`"status`":`"queued`"}"
Assert $t.id "Task creation failed"
Ok "Task $($t.id)"

# 4. Spawn worker
$suffix = "e2e-$ts"
$body = "{`"task_id`":`"$($t.id)`",`"suffix`":`"$suffix`",`"stream_id`":`"$suffix`",`"runner_type`":`"ollama`",`"model`":`"qwen3-coder:latest`",`"spawn`":true}"
$w = Invoke-RestMethod -Uri "$HUB/api/missions/$($m.id)/start" -Method Post -ContentType 'application/json' -Body $body
Assert ($w.id -and $w.spawn_result.errors.Count -eq 0) "Worker spawn failed: $($w.spawn_result.errors)"
Ok "Worker $($w.id) spawned"

# 5. Poll for completion (max 3 min)
Write-Host "  ...polling for completion (max 3 min)..."
$deadline = (Get-Date).AddMinutes(3)
$final_status = $null
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 8
    $wstate = Invoke-RestMethod -Uri "$HUB/api/workers/$($w.id)"
    Write-Host "      [$([int]((Get-Date) - (Get-Date).AddMinutes(-3)).TotalSeconds * -1)s] $($wstate.status)"
    if ($wstate.status -in ('done','failed','complete')) {
        $final_status = $wstate.status
        break
    }
}
Assert ($final_status -eq 'done') "Worker did not reach 'done' status (got '$final_status')"
Ok "Worker completed with status: $final_status"

# 6. Check task marked done
$tstate = Invoke-RestMethod -Uri "$HUB/api/tasks/$($t.id)"
Assert ($tstate.status -eq 'done') "Task not marked done (got '$($tstate.status)')"
Ok "Task marked done"

# 7. Check transcript
$transcript = Invoke-RestMethod -Uri "$HUB/api/workers/$($w.id)/transcript"
Assert ($transcript.available -eq $true) "Transcript not available"
Assert ($transcript.total_lines -gt 0) "Transcript empty"
Ok "Transcript available ($($transcript.total_lines) lines)"

# 8. Check file was created
$files = Get-ChildItem $proj_path -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*.py" }
Assert ($files.Count -gt 0) "No .py file created in project dir $proj_path"
Ok "File created: $($files[0].Name) ($($files[0].Length) bytes)"

Write-Host "`nAll checks passed." -ForegroundColor Green
