# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
#
# Weekly: the knowledge-loop metrics of the last 7 days (`wb metrics`, ADR-0041) as a report.
. (Join-Path $PSScriptRoot 'wb-env.ps1')

$arguments = @('metrics', '--check')
if ($Wb.WB_TASKS_DIR) { $arguments += @('--tasks', $Wb.WB_TASKS_DIR) }
if ($Wb.WB_STORE) { $arguments += @('--store', $Wb.WB_STORE) }
if ($Wb.WB_ATLAS_DIR) { $arguments += @('--atlas', $Wb.WB_ATLAS_DIR) }
if ($Wb.WB_GATE_RULES) { $arguments += @('--gate-rules', $Wb.WB_GATE_RULES) }

$r = Invoke-Wb $arguments
if ($r.Code -eq 0 -or $r.Code -eq 1) { Write-Output $r.Out; exit 0 }
Write-Output "Worldbuilder metrics FAILED (wb exit $($r.Code)):`n$($r.Out)`n$($r.Err)"
exit $r.Code
