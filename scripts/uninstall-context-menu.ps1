$ErrorActionPreference = "SilentlyContinue"

$root = [Microsoft.Win32.Registry]::CurrentUser
$targets = @(
  "Software\Classes\*\shell\mCompare",
  "Software\Classes\Directory\shell\mCompare"
)

foreach ($target in $targets) {
  $root.DeleteSubKeyTree($target, $false)
}

Write-Host "Removed 'Compare with mCompare' context menu entries."
