# PlanTakeoff PowerShell AI Extension

PlanTakeoff **Scope / AI** and **Plan-sweep** call this extension instead of requiring a separate `XAI_API_KEY`.

## How it works

```
PlanTakeoff UI  →  local server  →  Invoke-PlanTakeoffAI.ps1  →  grok.exe -p
```

Uses your **Grok Build** login (`%USERPROFILE%\.grok\`) — the same auth as this PowerShell agent.

## Manual test

```powershell
cd C:\Users\samuc\plan-takeoff\extensions
@"
Project: Test Job
TAKEOFF:
- Walls: 1200 SF
Write a 3-bullet painting scope.
"@ | Set-Content -Encoding utf8 ..\data\ai_work\test_prompt.txt

powershell -NoProfile -ExecutionPolicy Bypass -File .\Invoke-PlanTakeoffAI.ps1 `
  -Mode scope `
  -PromptFile ..\data\ai_work\test_prompt.txt `
  -OutFile ..\data\ai_work\test_out.txt

Get-Content ..\data\ai_work\test_out.txt
```

## Requirements

- Grok CLI at `%USERPROFILE%\.grok\bin\grok.exe` (already installed if you use Grok Build)
- Logged in to Grok (`grok` auth)

## Fallback

If Grok CLI is missing, the server falls back to `XAI_API_KEY` + `https://api.x.ai/v1` when set.
