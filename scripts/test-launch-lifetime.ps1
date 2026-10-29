# Interactive Windows test. Requires the tray/service to be stopped first.
# Leaves the verified independent tray running on success.
param([switch]$DirectLaunchControl)
$ErrorActionPreference = 'Stop'
$quotaRoot = Split-Path $PSScriptRoot -Parent
$quotaExe = Join-Path $quotaRoot 'AI-head-up-dispaly.exe'
if (@(Get-Process -Name AI-head-up-dispaly,Headroom -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -eq $quotaExe -or $_.Path -eq (Join-Path $quotaRoot 'Headroom.exe')
}).Count) { throw 'Exit the project tray before running this test.' }
try { $null = Invoke-WebRequest http://127.0.0.1:4317/api/dashboard -TimeoutSec 2 -UseBasicParsing; $quotaServiceRunning = $true } catch { $quotaServiceRunning = $false }
if ($quotaServiceRunning) { throw 'Stop the existing local service before running this test.' }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class QuotaLifetimeJob {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr handle);
}
'@
$quotaTestFolder = Join-Path $quotaRoot ('artifacts\lifetime-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $quotaTestFolder
$quotaGate = Join-Path $quotaTestFolder 'start.gate'
$quotaHelperScript = Join-Path $quotaTestFolder 'helper.ps1'
@'
param($AppRoot, $Gate, $LaunchMode)
$ErrorActionPreference = 'Stop'
$deadline = [DateTime]::UtcNow.AddSeconds(30)
while (-not (Test-Path -LiteralPath $Gate)) {
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Test gate timed out' }
    Start-Sleep -Milliseconds 100
}
if ($LaunchMode -eq 'direct') {
    Start-Process (Join-Path $AppRoot 'AI-head-up-dispaly.exe') -ArgumentList '--background' -WindowStyle Hidden
} else {
    & (Join-Path $AppRoot 'Start-Headroom.ps1') -Background
}
Start-Sleep -Seconds 60
'@ | Set-Content -LiteralPath $quotaHelperScript -Encoding UTF8
$quotaJob = [QuotaLifetimeJob]::CreateJobObject([IntPtr]::Zero, $null)
if ($quotaJob -eq [IntPtr]::Zero) { throw 'Could not create test job' }
$quotaHelper = $null
try {
    $quotaMode = if ($DirectLaunchControl) { 'direct' } else { 'desktop' }
    $quotaHelper = Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','RemoteSigned','-File',('"'+$quotaHelperScript+'"'),('"'+$quotaRoot+'"'),('"'+$quotaGate+'"'),$quotaMode) -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $quotaTestFolder 'stderr.log')
    if (-not [QuotaLifetimeJob]::AssignProcessToJobObject($quotaJob, $quotaHelper.Handle)) { throw 'Could not assign helper to test job' }
    $null = New-Item -ItemType File -Path $quotaGate
    $quotaDeadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 250
        $quotaTrays = @(Get-CimInstance Win32_Process -Filter "Name = 'AI-head-up-dispaly.exe'" | Where-Object ExecutablePath -eq $quotaExe)
    } while ($quotaTrays.Count -eq 0 -and [DateTime]::UtcNow -lt $quotaDeadline)
    if ($quotaTrays.Count -ne 1) { throw 'Expected exactly one tray process' }
    $quotaTray = Get-Process -Id $quotaTrays[0].ProcessId
    $quotaInside = $false
    if (-not [QuotaLifetimeJob]::IsProcessInJob($quotaTray.Handle, $quotaJob, [ref]$quotaInside)) { throw 'Tray membership check failed' }
    if ($quotaInside) { throw 'Tray inherited the launching session job' }
    $quotaParent = Get-CimInstance Win32_Process -Filter "ProcessId = $($quotaTrays[0].ParentProcessId)"
    if ($quotaParent.Name -ne 'explorer.exe') { throw 'Tray was not launched by the Windows desktop' }

    # Simulate the terminal/Codex terminating its entire managed process group.
    if (-not [QuotaLifetimeJob]::TerminateJobObject($quotaJob, 0)) { throw 'Could not terminate the test launch session' }
    if (-not $quotaHelper.WaitForExit(5000)) { throw 'Launching session is still alive' }
    Start-Sleep -Seconds 2
    if ($quotaTray.HasExited) { throw 'Tray died with the launching session' }
    $quotaView = Invoke-RestMethod http://127.0.0.1:4317/api/dashboard -TimeoutSec 10
    if ($null -eq $quotaView.providers) { throw 'Local service unavailable after session termination' }
    $quotaServices = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.ParentProcessId -eq $quotaTray.Id -and $_.CommandLine -like ('*"'+(Join-Path $quotaRoot 'server.mjs')+'"*') })
    if ($quotaServices.Count -ne 1) { throw 'Service is not owned by the independent tray' }
    $quotaService = Get-Process -Id $quotaServices[0].ProcessId
    if (-not [QuotaLifetimeJob]::IsProcessInJob($quotaService.Handle, $quotaJob, [ref]$quotaInside) -or $quotaInside) { throw 'Service inherited the launching session job' }
    & (Join-Path $quotaRoot 'Start-Headroom.ps1') -Background
    Start-Sleep -Seconds 1
    if (@(Get-Process -Name AI-head-up-dispaly | Where-Object Path -eq $quotaExe).Count -ne 1) { throw 'Repeated startup created duplicate trays' }
    [pscustomobject]@{TrayPid=$quotaTray.Id;ServicePid=$quotaService.Id;Parent=$quotaParent.Name;LaunchSessionTerminated=$true;TrayAndServiceSurvived=$true;SingleInstance=$true} | ConvertTo-Json
} finally {
    [void][QuotaLifetimeJob]::TerminateJobObject($quotaJob, 0)
    [void][QuotaLifetimeJob]::CloseHandle($quotaJob)
    if ($null -ne $quotaHelper) {
        if (-not $quotaHelper.HasExited) { $quotaHelper.Kill(); $quotaHelper.WaitForExit() }
        $quotaHelper.Dispose()
    }
    Remove-Item -LiteralPath $quotaGate,$quotaHelperScript -Force -ErrorAction SilentlyContinue
}
