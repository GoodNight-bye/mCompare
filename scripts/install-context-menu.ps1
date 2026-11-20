param(
  [string]$ExePath = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ExePath)) {
  $releaseDir = Join-Path (Split-Path -Parent $PSScriptRoot) "release"
  $candidate = Get-ChildItem -Path $releaseDir -Filter "mCompare*.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($candidate) { $ExePath = $candidate.FullName }
}

if ([string]::IsNullOrWhiteSpace($ExePath) -or -not (Test-Path -LiteralPath $ExePath)) {
  Write-Error "mCompare.exe not found. Pass -ExePath 'C:\path\to\mCompare.exe' (run 'npm run dist' first)."
  exit 1
}

$exe = (Resolve-Path -LiteralPath $ExePath).Path
$command = '"' + $exe + '" "%1"'
$root = [Microsoft.Win32.Registry]::CurrentUser

$targets = @(
  "Software\Classes\*\shell\mCompare",
  "Software\Classes\Directory\shell\mCompare"
)

foreach ($target in $targets) {
  $key = $root.CreateSubKey($target)
  $key.SetValue("", "Compare with mCompare")
  $key.SetValue("Icon", $exe)
  $cmd = $key.CreateSubKey("command")
  $cmd.SetValue("", $command)
  $cmd.Close()
  $key.Close()
}

Write-Host "Registered 'Compare with mCompare' for files and folders."
Write-Host "Executable: $exe"
Write-Host "Tip: select one file and choose the menu item twice (or select two files and use it once) - mCompare fills the second side automatically."
