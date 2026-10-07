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
