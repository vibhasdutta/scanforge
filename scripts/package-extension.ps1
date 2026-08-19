$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifest = Get-Content -Raw (Join-Path $projectRoot 'manifest.json') | ConvertFrom-Json
$releaseRoot = Join-Path $projectRoot 'release'
$stagingRoot = Join-Path $releaseRoot 'extension'
$archivePath = Join-Path $releaseRoot "scanforge-extension-$($manifest.version).zip"
$firefoxArchivePath = Join-Path $releaseRoot "scanforge-firefox-extension-$($manifest.version).zip"

if (Test-Path -LiteralPath $stagingRoot) {
  $resolvedStaging = [System.IO.Path]::GetFullPath($stagingRoot)
  if (-not $resolvedStaging.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar)) {
    throw "Refusing to remove staging directory outside the project: $resolvedStaging"
  }
  Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
}

New-Item -ItemType Directory -Path (Join-Path $stagingRoot 'dist') -Force | Out-Null

$rootFiles = @(
  'manifest.json',
  'Scanforge.png'
)

foreach ($file in $rootFiles) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Join-Path $stagingRoot $file)
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'assets') -Destination (Join-Path $stagingRoot 'assets') -Recurse
New-Item -ItemType Directory -Path (Join-Path $stagingRoot 'src') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'src\extension') -Destination (Join-Path $stagingRoot 'src\extension') -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist\background.js') -Destination (Join-Path $stagingRoot 'dist\background.js')

if (Test-Path -LiteralPath $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}
Compress-Archive -Path (Join-Path $stagingRoot '*') -DestinationPath $archivePath -CompressionLevel Optimal

Copy-Item -LiteralPath (Join-Path $projectRoot 'manifest.firefox.json') -Destination (Join-Path $stagingRoot 'manifest.json') -Force
if (Test-Path -LiteralPath $firefoxArchivePath) {
  Remove-Item -LiteralPath $firefoxArchivePath -Force
}
Compress-Archive -Path (Join-Path $stagingRoot '*') -DestinationPath $firefoxArchivePath -CompressionLevel Optimal
Remove-Item -LiteralPath $stagingRoot -Recurse -Force

Write-Host "Created $archivePath"
Write-Host "Created $firefoxArchivePath"
