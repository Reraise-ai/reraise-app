# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
#
# Nightly: regenerate the atlas pages from the cards (`wb digest`, ADR-0043). Silent on success.
. (Join-Path $PSScriptRoot 'wb-env.ps1')
Assert-WbSetting 'WB_STORE'

$arguments = @('digest', '--store', $Wb.WB_STORE)
if ($Wb.WB_ATLAS_DIR) { $arguments += @('--out', $Wb.WB_ATLAS_DIR) }
if ($Wb.WB_GATE_RULES) { $arguments += @('--gate-rules', $Wb.WB_GATE_RULES) }

$r = Invoke-Wb $arguments
if ($r.Code -eq 0) { exit 0 }
Write-Output "Worldbuilder atlas digest FAILED (wb exit $($r.Code)):`n$($r.Out)`n$($r.Err)"
exit $r.Code
