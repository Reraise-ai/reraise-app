# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
#
# Shared settings of the Worldbuilder knowledge-loop cron scripts (PowerShell variant of wb-env.sh);
# dot-sourced by the others. Works in Windows PowerShell 5.1 and PowerShell 7.
#
# Hermes runs only .sh/.bash (via bash) and Python files as cron scripts, so these .ps1 scripts are
# for Windows Task Scheduler or manual runs; see docs/how-to/connect-hermes.md.
# Settings come from %HERMES_HOME%\scripts\worldbuilder-loop.conf (KEY=VALUE lines), parsed, never run.

$ErrorActionPreference = 'Stop'

$hermesHome = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $HOME '.hermes' }
$WbConf = if ($env:WB_LOOP_CONF) { $env:WB_LOOP_CONF } else { Join-Path (Join-Path $hermesHome 'scripts') 'worldbuilder-loop.conf' }

$Wb = @{
    WB_BIN                 = if ($env:WB_BIN) { $env:WB_BIN } else { 'wb' }
    WB_STATE_DIR           = [string]$env:WB_STATE_DIR
    WB_STORE               = [string]$env:WB_STORE
    WB_TASKS_DIR           = [string]$env:WB_TASKS_DIR
    WB_ATLAS_DIR           = [string]$env:WB_ATLAS_DIR
    WB_GATE_RULES          = [string]$env:WB_GATE_RULES
    WB_TASK_LOOKBACK_HOURS = if ($env:WB_TASK_LOOKBACK_HOURS) { $env:WB_TASK_LOOKBACK_HOURS } else { '24' }
    WB_MAX_ATLAS_LAG_HOURS = if ($env:WB_MAX_ATLAS_LAG_HOURS) { $env:WB_MAX_ATLAS_LAG_HOURS } else { '72' }
    WB_PENDING_FILE        = [string]$env:WB_PENDING_FILE
    WB_OUTBOX_CLI          = [string]$env:WB_OUTBOX_CLI
    WB_PYTHON              = if ($env:WB_PYTHON) { $env:WB_PYTHON } else { 'python' }
    WB_PENDING_MAX_AGE_HOURS = if ($env:WB_PENDING_MAX_AGE_HOURS) { $env:WB_PENDING_MAX_AGE_HOURS } else { '24' }
}

if (Test-Path -LiteralPath $WbConf -PathType Leaf) {
    foreach ($line in Get-Content -LiteralPath $WbConf) {
        if ($line.Trim() -eq '' -or $line.TrimStart().StartsWith('#')) { continue }
        $index = $line.IndexOf('=')
        $key = if ($index -ge 0) { $line.Substring(0, $index).Trim() } else { $line.Trim() }
        if (-not $Wb.ContainsKey($key)) {
            [Console]::Error.WriteLine("worldbuilder-loop.conf: unknown key '$key'")
            exit 2
        }
        $Wb[$key] = if ($index -ge 0) { $line.Substring($index + 1).TrimEnd("`r") } else { '' }
    }
}

# The task records the plugin writes (setting task_records_dir) are the default WB_TASKS_DIR.
$defaultTasks = Join-Path (Join-Path $hermesHome 'worldbuilder') 'task-records'
if (-not $Wb.WB_TASKS_DIR -and (Test-Path -LiteralPath $defaultTasks -PathType Container)) { $Wb.WB_TASKS_DIR = $defaultTasks }

if (-not $Wb.WB_PENDING_FILE) { $Wb.WB_PENDING_FILE = Join-Path (Join-Path $hermesHome 'worldbuilder') 'pending-write-back.jsonl' }
if (-not $Wb.WB_OUTBOX_CLI) { $Wb.WB_OUTBOX_CLI = Join-Path (Join-Path (Join-Path $hermesHome 'plugins') 'worldbuilder-knowledge-loop') 'outbox.py' }

# Test-WbPending: report the pending write-back outbox (ADR-0046); returns @{ Code; Out }.
# Code 0 nothing stale, 4 an entry older than WB_PENDING_MAX_AGE_HOURS is still not flushed, 2 the check failed.
function Test-WbPending {
    if (-not (Test-Path -LiteralPath $Wb.WB_PENDING_FILE)) { return @{ Code = 0; Out = '' } }
    if (-not (Test-Path -LiteralPath $Wb.WB_OUTBOX_CLI -PathType Leaf)) {
        return @{ Code = 2; Out = "Worldbuilder pending write-back: $($Wb.WB_PENDING_FILE) exists but the checker $($Wb.WB_OUTBOX_CLI) is missing (set WB_OUTBOX_CLI)." }
    }
    if (-not (Get-Command $Wb.WB_PYTHON -ErrorAction SilentlyContinue)) {
        return @{ Code = 2; Out = "Worldbuilder pending write-back: $($Wb.WB_PYTHON) is not available to run the checker (set WB_PYTHON)." }
    }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $global:LASTEXITCODE = 0
        $out = (& $Wb.WB_PYTHON $Wb.WB_OUTBOX_CLI check --file $Wb.WB_PENDING_FILE --max-age-hours $Wb.WB_PENDING_MAX_AGE_HOURS 2>&1 | Out-String).TrimEnd()
        $code = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previous }
    if ($code -ne 0 -and $code -ne 4) { $out = "Worldbuilder pending write-back could not be checked (exit $code):`n$out" }
    return @{ Code = $code; Out = $out }
}

# Invoke-Wb <args...>: run wb; returns @{ Code; Out; Err } (WB_BIN may be "node C:\path\dist\bin.js").
function Invoke-Wb {
    param([string[]]$Arguments)
    $parts = @($Wb.WB_BIN -split '\s+' | Where-Object { $_ -ne '' })
    $exe = $parts[0]
    $all = @()
    if ($parts.Count -gt 1) { $all += $parts[1..($parts.Count - 1)] }
    $all += $Arguments
    if ($Wb.WB_STATE_DIR) { $all += @('--state', $Wb.WB_STATE_DIR) }
    $errFile = [System.IO.Path]::GetTempFileName()
    # Windows PowerShell 5.1 wraps native stderr lines in error records, which 'Stop' would turn
    # into a terminating error before $LASTEXITCODE is read: run with 'Continue' for this one call.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $global:LASTEXITCODE = 0
        $out = & $exe @all 2>$errFile
        $code = $LASTEXITCODE
        $ErrorActionPreference = $previous
        return @{ Code = $code; Out = (($out | Out-String).TrimEnd()); Err = ((Get-Content -LiteralPath $errFile -Raw) + '').TrimEnd() }
    }
    finally { $ErrorActionPreference = $previous; Remove-Item -LiteralPath $errFile -Force -ErrorAction SilentlyContinue }
}

function Assert-WbSetting {
    param([string]$Name)
    if (-not $Wb[$Name]) {
        [Console]::Error.WriteLine("$Name is not set (set it in $WbConf)")
        exit 2
    }
}
