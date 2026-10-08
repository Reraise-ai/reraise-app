# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
#
# Nightly: verify the receipts of the day's task records (`wb receipts verify`, ADR-0040); see
# wb-nightly-validate.sh for the semantics (silent when valid; exit 1 failed, 3 broken log, 2 cannot verify;
# also reports the pending write-back outbox and exits 4 when an entry is older than 24 h and still not flushed).
. (Join-Path $PSScriptRoot 'wb-env.ps1')
Assert-WbSetting 'WB_TASKS_DIR'
if (-not (Test-Path -LiteralPath $Wb.WB_TASKS_DIR -PathType Container)) {
    [Console]::Error.WriteLine('wb-nightly-validate: WB_TASKS_DIR is not a directory')
    exit 2
}

$pending = Test-WbPending
if ($pending.Out) { Write-Output $pending.Out }

$since = (Get-Date).AddHours(-[double]$Wb.WB_TASK_LOOKBACK_HOURS)
$files = @(Get-ChildItem -LiteralPath $Wb.WB_TASKS_DIR -Recurse -File |
    Where-Object { ($_.Extension -eq '.md' -or $_.Extension -eq '.json') -and $_.LastWriteTime -gt $since })
if ($files.Count -eq 0) { exit $pending.Code }

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("wb-validate-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $n = 0
    foreach ($f in $files) {
        $n++
        Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $tmp "$n-$($f.Name)")
    }
    $r = Invoke-Wb @('receipts', 'verify', $tmp)
}
finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }

if ($r.Code -eq 0) { exit $pending.Code }
switch ($r.Code) {
    1 { Write-Output "Worldbuilder receipts: $($files.Count) task record(s) of the last $($Wb.WB_TASK_LOOKBACK_HOURS) h, at least one has NO VALID RECEIPTS:`n$($r.Out)" }
    3 { Write-Output "Worldbuilder receipt log is BROKEN (tamper evidence); every task fails:`n$($r.Out)" }
    default { Write-Output "Worldbuilder receipts could not be verified (wb exit $($r.Code)):`n$($r.Out)`n$($r.Err)" }
}
exit $r.Code
