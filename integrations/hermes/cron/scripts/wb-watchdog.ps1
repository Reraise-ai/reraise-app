# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
#
# Watchdog: say something only when the loop has stopped (atlas out of date for more than
# WB_MAX_ATLAS_LAG_HOURS, or no agent card accepted in 7 days). See wb-watchdog.sh.
. (Join-Path $PSScriptRoot 'wb-env.ps1')
Assert-WbSetting 'WB_STORE'

$arguments = @('metrics', '--json', '--store', $Wb.WB_STORE)
if ($Wb.WB_TASKS_DIR) { $arguments += @('--tasks', $Wb.WB_TASKS_DIR) }
if ($Wb.WB_ATLAS_DIR) { $arguments += @('--atlas', $Wb.WB_ATLAS_DIR) }
if ($Wb.WB_GATE_RULES) { $arguments += @('--gate-rules', $Wb.WB_GATE_RULES) }

$r = Invoke-Wb $arguments
if ($r.Code -ne 0) {
    Write-Output "Worldbuilder watchdog: wb metrics FAILED (exit $($r.Code)):`n$($r.Out)`n$($r.Err)"
    exit $r.Code
}
try { $m = $r.Out | ConvertFrom-Json }
catch {
    Write-Output "Worldbuilder watchdog: cannot read the metrics: $($_.Exception.Message)"
    exit 2
}

$alerts = @()
$max = [double]$Wb.WB_MAX_ATLAS_LAG_HOURS
$lag = $m.atlas.lagHours
if ($null -eq $lag) { $alerts += 'atlas: no pages, or the lag cannot be determined - run wb digest' }
elseif ([double]$lag -gt $max) { $alerts += "atlas: out of date for $lag h (limit $max h) - run wb digest" }
if (-not $m.totals.cardsAccepted) { $alerts += "cards: no agent card accepted in the last 7 days ($([int]$m.totals.cardsProposed) proposed)" }

if ($alerts.Count -eq 0) { exit 0 }
Write-Output ("Worldbuilder knowledge loop needs attention:`n" + ($alerts -join "`n"))
exit 0
