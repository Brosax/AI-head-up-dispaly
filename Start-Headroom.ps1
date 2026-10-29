param([switch]$Toolbar, [switch]$Background)
$ErrorActionPreference = 'Stop'
$headroomExecutable = Join-Path $PSScriptRoot 'AI-head-up-dispaly.exe'
if (-not (Test-Path -LiteralPath $headroomExecutable -PathType Leaf)) {
    throw 'Build the desktop app first: npm.cmd run build:desktop'
}

# Ask the Windows desktop to launch the tray. Start-Process/start would inherit
# the calling terminal's job, which can be terminated when Codex exits.
# -Toolbar remains accepted for existing shortcuts; the tray opens it by default.
$headroomArguments = if ($Background) { '--background' } else { '' }
$headroomWindowStyle = if ($Background) { 0 } else { 1 }
$headroomShell = New-Object -ComObject Shell.Application
$headroomWindows = $null
$headroomDesktop = $null
$headroomDocument = $null
$headroomDesktopShell = $null
try {
    # Shell.Application alone can execute inside this caller. Get the existing
    # desktop's automation object so explorer.exe actually owns the new process.
    $headroomWindows = $headroomShell.Windows()
    $headroomDesktopHandle = 0
    $headroomDesktop = $headroomWindows.FindWindowSW(0, 0, 8, [ref]$headroomDesktopHandle, 1)
    if ($null -eq $headroomDesktop) { throw 'Windows desktop is unavailable. Open the app from File Explorer.' }
    $headroomDocument = $headroomDesktop.Document
    $headroomDesktopShell = $headroomDocument.Application
    $headroomDesktopShell.ShellExecute($headroomExecutable, $headroomArguments, $PSScriptRoot, 'open', $headroomWindowStyle)
} finally {
    foreach ($headroomComObject in @($headroomDesktopShell, $headroomDocument, $headroomDesktop, $headroomWindows, $headroomShell)) {
        if ($null -ne $headroomComObject) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($headroomComObject) }
    }
}
