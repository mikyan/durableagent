param(
    [Parameter(Mandatory = $true)][string]$Device,
    [string]$Adb = 'adb',
    [int]$Iterations = 3,
    [string]$EvidenceDirectory = (Join-Path $env:TEMP 'durableagent-termux-cold-start')
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null
function DeviceCommand {
    & $Adb -s $Device @args
    if ($LASTEXITCODE -ne 0 -and ($args -join ' ') -notmatch '^shell pidof ') {
        throw 'ADB command failed; do not treat stale diagnostics as a fresh result'
    }
}
function ReadDiagnostic { (DeviceCommand shell run-as dev.durableagent.termuxprobe cat no_backup/last-inspection.txt) -join "`n" }
function DiagnosticNonce([string]$Diagnostic) {
    if ($Diagnostic -match '(?m)^nonce=([a-zA-Z0-9-]+)\s*$') { return $Matches[1] }
    return ''
}
function LaunchAndObserve([string]$Name) {
    $previous = ReadDiagnostic
    $previousNonce = DiagnosticNonce $previous
    DeviceCommand shell input keyevent 3 | Out-Null
    Start-Sleep -Milliseconds 400
    $launch = DeviceCommand shell am start -W -n dev.durableagent.termuxprobe/.MainActivity
    $deadline = [DateTime]::UtcNow.AddSeconds(23)
    do {
        Start-Sleep -Milliseconds 200
        $current = ReadDiagnostic
        if ($current -match 'phase=(\w+)' -and $Matches[1] -ne 'CHECKING') {
            if ($Matches[1] -ne 'READY' -and $current -ne $previous) { break }
            if ($Matches[1] -eq 'READY' -and (DiagnosticNonce $current) -ne $previousNonce) { break }
        }
    } while ([DateTime]::UtcNow -lt $deadline)
    "Action: $Name`nObserved: $(Get-Date -Format o)`n$($launch -join "`n")`n$current" |
        Set-Content -LiteralPath (Join-Path $EvidenceDirectory "$Name.txt") -Encoding utf8
    $currentNonce = DiagnosticNonce $current
    if (!$currentNonce -or $currentNonce -eq $previousNonce -or $current -notmatch 'phase=READY,') {
        Write-Output "FAIL $Name : READY with a new challenge absent (see saved diagnostic)"
        return $false
    }
    Write-Output "PASS $Name"
    return $true
}
# Explicitly destroys only the two test app processes; never clear/uninstall or force-stop.
for ($iteration = 1; $iteration -le $Iterations; $iteration++) {
    $termuxProcess = ((DeviceCommand shell pidof com.termux) -join '').Trim()
    if ($termuxProcess -notmatch '^\d+$') { throw 'Process-death scenario requires exactly one running Termux PID; no death was injected' }
    DeviceCommand shell run-as com.termux kill -9 $termuxProcess | Out-Null
    Start-Sleep -Milliseconds 100
    $afterKill = ((DeviceCommand shell pidof com.termux) -join '').Trim()
    if (($afterKill -split '\s+') -contains $termuxProcess) { throw 'Original Termux PID survived the injected kill' }
    $first = @(LaunchAndObserve "iteration-$iteration-termux-process-death")
    $first | Where-Object { $_ -is [string] } | Write-Output
    if ($first[-1] -ne $true) { exit 1 }
    $restartedProcess = ((DeviceCommand shell pidof com.termux) -join '').Trim()
    if ($restartedProcess -notmatch '^\d+$' -or $restartedProcess -eq $termuxProcess) { throw 'READY lacked a distinct restarted Termux PID' }
    "Termux PID before kill: $termuxProcess`nPID immediately after kill: $afterKill`nPID after READY: $restartedProcess" |
        Add-Content -LiteralPath (Join-Path $EvidenceDirectory "iteration-$iteration-termux-process-death.txt") -Encoding utf8
    DeviceCommand shell input keyevent 3 | Out-Null
    Start-Sleep -Seconds 3
    DeviceCommand shell am kill dev.durableagent.termuxprobe | Out-Null
    Start-Sleep -Milliseconds 400
    $remaining = DeviceCommand shell pidof dev.durableagent.termuxprobe
    if ($remaining) { throw 'Android did not reclaim the fixture; do not claim a cold start' }
    $second = @(LaunchAndObserve "iteration-$iteration-host-cold-start")
    $second | Where-Object { $_ -is [string] } | Write-Output
    if ($second[-1] -ne $true) { exit 1 }
}
