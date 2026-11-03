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
function LaunchAndObserve([string]$Name) {
    $previous = ReadDiagnostic
    DeviceCommand shell input keyevent 3 | Out-Null
    Start-Sleep -Milliseconds 400
    $launch = DeviceCommand shell am start -W -n dev.durableagent.termuxprobe/.MainActivity
    $deadline = [DateTime]::UtcNow.AddSeconds(23)
    do {
        Start-Sleep -Milliseconds 200
        $current = ReadDiagnostic
        if ($current -ne $previous -and $current -match 'phase=(\w+)' -and $Matches[1] -ne 'CHECKING') { break }
    } while ([DateTime]::UtcNow -lt $deadline)
    "Action: $Name`nObserved: $(Get-Date -Format o)`n$($launch -join "`n")`n$current" |
        Set-Content -LiteralPath (Join-Path $EvidenceDirectory "$Name.txt") -Encoding utf8
    if ($current -eq $previous -or $current -notmatch 'phase=READY,') { Write-Output "FAIL $Name : fresh READY absent (see saved diagnostic)"; return $false }
    Write-Output "PASS $Name"
    return $true
}
# Explicitly destroys only the two test app processes; never clear/uninstall or force-stop.
for ($iteration = 1; $iteration -le $Iterations; $iteration++) {
    $termuxProcess = ((DeviceCommand shell pidof com.termux) -join '').Trim()
    if ($termuxProcess -match '^\d+$') { DeviceCommand shell run-as com.termux kill -9 $termuxProcess | Out-Null }
    $first = @(LaunchAndObserve "iteration-$iteration-termux-process-death")
    $first | Where-Object { $_ -is [string] } | Write-Output
    if ($first[-1] -ne $true) { exit 1 }
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
