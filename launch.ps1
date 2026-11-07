$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSCommandPath
$Electron = Join-Path $ProjectRoot 'node_modules\electron\dist\electron.exe'
$LogDir = Join-Path $env:LOCALAPPDATA 'DesktopRobotLauncher'

if (-not (Test-Path -LiteralPath $Electron)) {
    $shell = New-Object -ComObject WScript.Shell
    $null = $shell.Popup("Electron is not installed yet.`n`nOpen a terminal in the project folder and run: npm install", 0, 'Desktop Robot', 16)
    exit 1
}

try {
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
} catch {
    # The variable simply does not exist.
}

try {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    # Keep runtime data beside the checkout. This also avoids Windows
    # crashpad/profile lock failures in restricted desktop environments.
    $RuntimeDir = Join-Path $ProjectRoot '.runtime'
    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    $env:DESKTOP_ROBOT_USER_DATA = $RuntimeDir
    $stdout = Join-Path $LogDir 'launcher.out.log'
    $stderr = Join-Path $LogDir 'launcher.err.log'
    Start-Process -FilePath $Electron `
        -ArgumentList '--no-sandbox', '--disable-gpu', ('"' + $ProjectRoot + '"') `
        -WorkingDirectory $ProjectRoot `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr
} catch {
    $shell = New-Object -ComObject WScript.Shell
    $null = $shell.Popup("Desktop Robot could not be started.`n`n$($_.Exception.Message)", 0, 'Desktop Robot', 16)
    exit 1
}
