# Creates the double-click launcher/shortcut for the current checkout.
# Run from the project directory with:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\create-shortcut.ps1

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Electron = Join-Path $ProjectRoot 'node_modules\electron\dist\electron.exe'
$Launcher = Join-Path $ProjectRoot 'launch.ps1'
$PowerShellExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$Icon = Join-Path $ProjectRoot 'assets\icons\app.ico'
$ShortcutName = '桌面小机.lnk'

if (-not (Test-Path -LiteralPath $Electron)) {
    throw "Electron 尚未安装或缺少可执行文件：$Electron`n请先在项目目录运行 npm install。"
}
if (-not (Test-Path -LiteralPath $Launcher)) {
    throw "缺少启动脚本：$Launcher"
}
if (-not (Test-Path -LiteralPath $Icon)) {
    throw "缺少快捷方式图标：$Icon"
}

$WshShell = New-Object -ComObject WScript.Shell

$ProjectShortcut = Join-Path $ProjectRoot $ShortcutName
$shortcut = $WshShell.CreateShortcut($ProjectShortcut)
$shortcut.TargetPath = $PowerShellExe
$shortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $Launcher + '"'
$shortcut.WorkingDirectory = $ProjectRoot
$shortcut.IconLocation = "$Icon,0"
$shortcut.Description = 'Desktop Robot · 桌面小机'
$shortcut.WindowStyle = 1
$shortcut.Save()
Write-Host "已创建：$ProjectShortcut"

$Desktop = [Environment]::GetFolderPath('Desktop')
if ($Desktop -and (Test-Path -LiteralPath $Desktop)) {
    $DesktopShortcut = Join-Path $Desktop $ShortcutName
    Copy-Item -LiteralPath $ProjectShortcut -Destination $DesktopShortcut -Force
    Write-Host "已创建：$DesktopShortcut"
} else {
    Write-Warning '未能找到当前用户的桌面目录，只创建了项目内快捷方式。'
}

Write-Host '以后双击“桌面小机”即可启动，不需要命令行。'
