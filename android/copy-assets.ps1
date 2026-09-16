# Kopira web fajlove u android/app/src/main/assets/
# Pokrenuti iz korijenskog direktorija projekta: powershell -ExecutionPolicy Bypass -File android\copy-assets.ps1

$ErrorActionPreference = "Stop"

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Resolve-Path "$ScriptDir\.."
$AssetsDir  = Join-Path $ScriptDir "app\src\main\assets"

if (Test-Path $AssetsDir) { Remove-Item $AssetsDir -Recurse -Force }
$null = New-Item -ItemType Directory -Path $AssetsDir
$null = New-Item -ItemType Directory -Path "$AssetsDir\static"
$null = New-Item -ItemType Directory -Path "$AssetsDir\geo"

$MainFiles = @("index.html","manifest.json","sw.js","icon-192.png","icon-512.png","apple-touch-icon.png")
foreach ($f in $MainFiles) {
    $src = Join-Path $ProjectDir $f
    if (Test-Path $src) { Copy-Item $src "$AssetsDir\" }
}

$Folders = @("geo","static")
foreach ($folder in $Folders) {
    $src = Join-Path $ProjectDir $folder
    if (Test-Path $src) {
        Copy-Item "$src\*" "$AssetsDir\$folder\" -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$sizeKB = [math]::Round((Get-ChildItem $AssetsDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1KB)
Write-Host "OK - Ukupna velicina assets: $sizeKB KB" -ForegroundColor Green
