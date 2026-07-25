<#
.SYNOPSIS
  PlanTakeoff AI extension — local Grok CLI via PowerShell (no XAI_API_KEY).

.DESCRIPTION
  PlanTakeoff server calls this for Scope / Plan-sweep.
  Uses authenticated Grok Build at %USERPROFILE%\.grok\bin\grok.exe

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File Invoke-PlanTakeoffAI.ps1 `
    -Mode plansweep -PromptFile .\prompt.txt -OutFile .\out.txt
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('scope', 'plansweep', 'raw')]
  [string]$Mode,

  [Parameter(Mandatory = $true)]
  [string]$PromptFile,

  [Parameter(Mandatory = $false)]
  [string]$OutFile = "",

  [Parameter(Mandatory = $false)]
  [string]$SystemRules = "",

  [Parameter(Mandatory = $false)]
  [string]$Model = "",

  [Parameter(Mandatory = $false)]
  [int]$TimeoutSec = 180
)

$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

function Find-GrokExe {
  $candidates = @(
    (Join-Path $env:USERPROFILE '.grok\bin\grok.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Grok\grok.exe'),
    'grok'
  )
  foreach ($c in $candidates) {
    if ($c -eq 'grok') {
      $cmd = Get-Command grok -ErrorAction SilentlyContinue
      if ($cmd) { return $cmd.Source }
    } elseif (Test-Path -LiteralPath $c) {
      return (Resolve-Path -LiteralPath $c).Path
    }
  }
  return $null
}

function Invoke-GrokPromptFile {
  param(
    [string]$GrokPath,
    [string]$PromptPath,
    [string]$WorkDir,
    [string]$ModelName,
    [string]$DenyTools
  )
  # Short single-line --rules only (newlines break the CLI parser)
  $shortRules = 'Final markdown only. No tools. No planning sentences. Start with a # heading.'
  $argsGrok = @()
  if ($ModelName) { $argsGrok += @('-m', $ModelName) }
  $argsGrok += @(
    '--prompt-file', $PromptPath
    '--output-format', 'plain'
    '--permission-mode', 'bypassPermissions'
    '--disallowed-tools', $DenyTools
    '--max-turns', '1'
    '--verbatim'
    '--rules', $shortRules
    '--no-auto-update'
  )

  Push-Location $WorkDir
  try {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $raw = & $GrokPath @argsGrok 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev

    $textLines = @()
    $errLines = @()
    foreach ($line in @($raw)) {
      if ($line -is [System.Management.Automation.ErrorRecord]) {
        $errLines += $line.ToString()
      } else {
        $textLines += [string]$line
      }
    }
    return @{
      Code   = $code
      Text   = ($textLines -join "`n").Trim()
      Stderr = ($errLines -join "`n").Trim()
    }
  }
  finally {
    Pop-Location
  }
}

function Test-IsPreamble {
  param([string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return $true }
  if ($Text.Length -ge 500 -and ($Text -match '(?m)^#{1,3}\s')) { return $false }
  if ($Text -match "(?i)^(i('ll| will| am going)|let me|i'll build|checking|first i|looking for|searching|i'll check)") {
    return $true
  }
  if ($Text.Length -lt 400 -and $Text -notmatch '(?m)^#{1,3}\s' -and $Text -notmatch '(?m)^-\s+\[') {
    return $true
  }
  return $false
}

# --- main ---
if (-not (Test-Path -LiteralPath $PromptFile)) {
  Write-Error "Prompt file not found: $PromptFile"
  exit 2
}

$prompt = [System.IO.File]::ReadAllText($PromptFile)
if ([string]::IsNullOrWhiteSpace($prompt)) {
  Write-Error "Prompt file is empty."
  exit 2
}

$grok = Find-GrokExe
if (-not $grok) {
  Write-Error "Grok CLI not found under %USERPROFILE%\.grok\bin\grok.exe"
  exit 3
}

$modeBlock = switch ($Mode) {
  'scope' {
    @'
ROLE: Bid editor for WL Painting Inc.
NO tools. Keep LOGIC DRAFT quantity lines. Do not invent work packages.
OUTPUT:
Project: ...
Scope of Work
1. Provide labor and materials to ...
Clarifications
1. ...
Exclusions
- ...
ASCII only. Numbers must match the draft.
'@
  }
  'plansweep' {
    @'
ROLE: Painting estimator auditor.
ONLY real findings with Evidence | Why it matters | Action.
NO generic amenity lists. NO invented finish tags.
NO "I'll check" sentences. ASCII only.
Start with ## Evidence-based plan-sweep
'@
  }
  default {
    'ROLE: Painting estimator. Final markdown only. First line is a # heading. No planning preamble.'
  }
}
if ($SystemRules) { $modeBlock = "$modeBlock`n$SystemRules" }

$fullPrompt = @"
$modeBlock

===== PROJECT DATA =====
$prompt
===== END DATA =====

Write the COMPLETE final document now. First character of your reply must be #.
"@

$workDir = Split-Path -Parent $PromptFile
if (-not $workDir) { $workDir = $env:TEMP }
$combined = Join-Path $workDir ("grok_prompt_{0}.txt" -f [guid]::NewGuid().ToString('N'))

$denyTools = @(
  'run_terminal_cmd', 'search_replace', 'spawn_subagent', 'Agent',
  'web_search', 'web_fetch', 'read_file', 'grep', 'list_dir',
  'todo_write', 'write', 'image_gen', 'image_edit'
) -join ','

try {
  [System.IO.File]::WriteAllText($combined, $fullPrompt, $utf8NoBom)

  $result = Invoke-GrokPromptFile -GrokPath $grok -PromptPath $combined -WorkDir $workDir -ModelName $Model -DenyTools $denyTools
  $text = $result.Text
  $code = $result.Code
  $stderr = $result.Stderr

  if ($code -ne 0 -and [string]::IsNullOrWhiteSpace($text)) {
    Write-Error "Grok exited $code. $stderr"
    exit 5
  }
  if (-not $text) {
    Write-Error "Grok returned empty output. $stderr"
    exit 6
  }

  if (Test-IsPreamble $text) {
    [Console]::Error.WriteLine("PLANTAKEOFF_AI_RETRY preamble_detected len=$($text.Length)")
    $retryPrompt = @"
INVALID prior reply (planning only). You have no tools.

Write the COMPLETE final document using ONLY the data below.
First line MUST be a markdown heading starting with #.

$prompt

First character of your reply must be #.
"@
    $retryFile = Join-Path $workDir ("grok_retry_{0}.txt" -f [guid]::NewGuid().ToString('N'))
    try {
      [System.IO.File]::WriteAllText($retryFile, $retryPrompt, $utf8NoBom)
      $r2 = Invoke-GrokPromptFile -GrokPath $grok -PromptPath $retryFile -WorkDir $workDir -ModelName $Model -DenyTools $denyTools
      if ($r2.Text -and $r2.Text.Length -gt $text.Length) {
        $text = $r2.Text
      } elseif ($r2.Text -and -not (Test-IsPreamble $r2.Text)) {
        $text = $r2.Text
      }
    }
    finally {
      Remove-Item -LiteralPath $retryFile -Force -ErrorAction SilentlyContinue
    }
  }

  if ($OutFile) {
    [System.IO.File]::WriteAllText($OutFile, $text, $utf8NoBom)
  } else {
    Write-Output $text
  }

  [Console]::Error.WriteLine("PLANTAKEOFF_AI_OK provider=grok-cli path=$grok chars=$($text.Length)")
  exit 0
}
finally {
  if (Test-Path -LiteralPath $combined) {
    Remove-Item -LiteralPath $combined -Force -ErrorAction SilentlyContinue
  }
}
