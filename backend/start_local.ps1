# Tiger Foods Agentic AI — local dev runner (Windows / PowerShell)
# Usage:  .\start_local.ps1
#         $env:PORT=9000; .\start_local.ps1

$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port        = if ($env:PORT) { $env:PORT } else { "8080" }

$env:PYTHONPATH  = "$PackageRoot\code;$PackageRoot\code\orchestrator_service"
$env:PROMPTS_DIR = "$PackageRoot\agents"
if (-not $env:PROJECT_ID) { $env:PROJECT_ID = "resilience-riskradar" }

Write-Host "Tiger Foods integrated v2 — starting locally"
Write-Host "  PACKAGE_ROOT = $PackageRoot"
Write-Host "  PYTHONPATH   = $($env:PYTHONPATH)"
Write-Host "  PROMPTS_DIR  = $($env:PROMPTS_DIR)"
Write-Host "  PROJECT_ID   = $($env:PROJECT_ID)"
Write-Host "  PORT         = $Port"
Write-Host ""
Write-Host "Endpoints:"
Write-Host "  POST   http://localhost:$Port/sessions"
Write-Host "  GET    http://localhost:$Port/sessions/{id}"
Write-Host "  POST   http://localhost:$Port/sessions/{id}/approve"
Write-Host "  POST   http://localhost:$Port/sessions/{id}/reject"
Write-Host "  GET    http://localhost:$Port/dashboard-data"
Write-Host "  POST   http://localhost:$Port/chat"
Write-Host "  GET    http://localhost:$Port/health"
Write-Host ""

Set-Location "$PackageRoot\code\orchestrator_service"
uvicorn main:app --host 0.0.0.0 --port $Port --reload
