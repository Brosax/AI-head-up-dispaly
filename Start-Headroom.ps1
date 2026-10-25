param([switch]$Toolbar)
$ErrorActionPreference = 'Stop'
$headroomRoot = $PSScriptRoot
$headroomUrl = 'http://127.0.0.1:4317'
$headroomRunning = $false
try {
    $headroomResponse = Invoke-RestMethod -Uri "$headroomUrl/api/dashboard" -TimeoutSec 2
    $headroomRunning = $null -ne $headroomResponse.providers
} catch {}
if (-not $headroomRunning) {
    $headroomNode = (Get-Command node.exe -ErrorAction Stop).Source
    Start-Process -FilePath $headroomNode -ArgumentList 'server.mjs' -WorkingDirectory $headroomRoot -WindowStyle Hidden
    for ($headroomAttempt = 0; $headroomAttempt -lt 20; $headroomAttempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $headroomResponse = Invoke-RestMethod -Uri "$headroomUrl/api/dashboard" -TimeoutSec 1
            $headroomRunning = $null -ne $headroomResponse.providers
            if ($headroomRunning) { break }
        } catch {}
    }
}
if (-not $headroomRunning) { throw 'Headroom 启动失败。请在项目目录运行 node server.mjs 查看错误。' }
if ($Toolbar) {
    $headroomEdge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
    if (-not (Test-Path -LiteralPath $headroomEdge)) { $headroomEdge = Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe' }
    if (-not (Test-Path -LiteralPath $headroomEdge)) { throw '需要已安装 Headroom 扩展的 Microsoft Edge。' }
    # Reuse the user's normal Edge profile, so existing extension pairing and logins work.
    Start-Process -FilePath $headroomEdge -ArgumentList @('--app=http://127.0.0.1:4317/toolbar','--window-size=440,740')
} else { Start-Process $headroomUrl }
