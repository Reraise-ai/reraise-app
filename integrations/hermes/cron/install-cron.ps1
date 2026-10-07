# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
#
# Install the Worldbuilder knowledge-loop cron jobs into Hermes (PowerShell variant of install-cron.sh).
#
#   install-cron.ps1 [-DryRun] [-Deliver <target>] [-HermesHome <dir>]
#
# Hermes runs .sh scripts through bash (Git Bash on Windows), so the jobs use the .sh scripts; the
# .ps1 scripts are copied too, for Task Scheduler or manual runs. Existing jobs (by name) are left alone.
param(
    [switch]$DryRun,
    [string]$Deliver = 'local',
    [string]$HermesHome = $(if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $HOME '.hermes' })
)
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $HermesHome 'scripts'

$script:failed = 0
# Step <text> <action>: run it (or print it with -DryRun). A failure is counted and reported at the end.
function Step([string]$Text, [scriptblock]$Action) {
    if ($DryRun) { Write-Output "[dry-run] $Text"; return }
    # Windows PowerShell 5.1 turns native stderr into error records: only the exit code decides.
    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $global:LASTEXITCODE = 0
        & $Action
        if ($LASTEXITCODE -ne 0) { throw "exit code $LASTEXITCODE" }
    }
    catch {
        [Console]::Error.WriteLine("install-cron.ps1: FAILED: $Text ($($_.Exception.Message))")
        $script:failed++
    }
    finally { $ErrorActionPreference = $previous }
}

Step "create $dest" { New-Item -ItemType Directory -Force -Path $dest | Out-Null }
foreach ($f in Get-ChildItem -Path (Join-Path $here 'scripts\*') -File -Include '*.sh', '*.ps1') {
    Step "copy $($f.Name) to $dest" { Copy-Item -LiteralPath $f.FullName -Destination $dest -Force }
}
$conf = Join-Path $dest 'worldbuilder-loop.conf'
if (Test-Path -LiteralPath $conf) {
    Write-Output "kept existing $conf"
}
else {
    Step "create $conf from the example" { Copy-Item -LiteralPath (Join-Path $here 'scripts\worldbuilder-loop.conf.example') -Destination $conf }
    $verb = if ($DryRun) { 'would create' } else { 'created' }
    Write-Output "$verb $conf : edit it (store, task record folder) before the first run"
}

$existing = ''
if (-not $DryRun) {
    if (-not (Get-Command hermes -ErrorAction SilentlyContinue)) {
        [Console]::Error.WriteLine('install-cron.ps1: the hermes command is not on PATH')
        exit 2
    }
    # Windows PowerShell 5.1 turns native stderr into an error record: do not let it stop the script.
    $ErrorActionPreference = 'Continue'
    $listed = (& hermes cron list --all 2>$null | Out-String)
    $listCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($listCode -eq 0) { $existing = $listed }
    else {
        # Without the list a second run would create every job twice: read Hermes' job file instead.
        [Console]::Error.WriteLine("install-cron.ps1: hermes cron list failed; checking $HermesHome\cron\jobs.json for existing jobs")
        $jobsFile = Join-Path (Join-Path $HermesHome 'cron') 'jobs.json'
        if (Test-Path -LiteralPath $jobsFile) { $existing = Get-Content -LiteralPath $jobsFile -Raw }
    }
}

function Job([string]$Name, [string]$Schedule, [string]$Script) {
    if ($existing.Contains($Name)) { Write-Output "job $Name exists; left alone"; return }
    $text = "hermes cron create '$Schedule' --no-agent --script $Script --name $Name --deliver $Deliver"
    Step $text { & hermes cron create $Schedule --no-agent --script $Script --name $Name --deliver $Deliver }
}

Job 'worldbuilder-nightly-digest' '17 2 * * *' 'wb-nightly-digest.sh'
Job 'worldbuilder-nightly-validate' '37 3 * * *' 'wb-nightly-validate.sh'
Job 'worldbuilder-weekly-metrics' '23 7 * * MON' 'wb-weekly-metrics.sh'
Job 'worldbuilder-watchdog' '41 6 * * *' 'wb-watchdog.sh'

if ($script:failed -gt 0) {
    [Console]::Error.WriteLine("install-cron.ps1: $($script:failed) step(s) failed; fix the cause and run it again (finished jobs are left alone)")
    exit 1
}
Write-Output 'done. Check with: hermes cron list ; hermes cron doctor'
