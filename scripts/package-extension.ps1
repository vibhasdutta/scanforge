$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Compress-Archive stores Windows' '\' path separators as-is in the zip's central directory,
# which violates the ZIP spec (entries must use '/'). Windows tools quietly tolerate it, but
# unzip/Firefox/Chrome on Linux (and Python's zipfile, etc.) don't reconstruct subfolders from
# a backslash — they create one flat file with a literal backslash in its name instead, which
# breaks every relative asset/script path in the extension. Build entries by hand with '/' names.
function New-SpecCompliantZip($SourceDir, $DestZip) {
  if (Test-Path -LiteralPath $DestZip) { Remove-Item -LiteralPath $DestZip -Force }
  $archive = [System.IO.Compression.ZipFile]::Open($DestZip, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    $sourceFull = [System.IO.Path]::GetFullPath($SourceDir)
    Get-ChildItem -LiteralPath $SourceDir -Recurse -File | ForEach-Object {
      $relative = $_.FullName.Substring($sourceFull.Length).TrimStart('\', '/').Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $relative, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally {
    $archive.Dispose()
  }
}

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

New-SpecCompliantZip -SourceDir $stagingRoot -DestZip $archivePath

Copy-Item -LiteralPath (Join-Path $projectRoot 'manifest.firefox.json') -Destination (Join-Path $stagingRoot 'manifest.json') -Force
New-SpecCompliantZip -SourceDir $stagingRoot -DestZip $firefoxArchivePath
Remove-Item -LiteralPath $stagingRoot -Recurse -Force

Write-Host "Created $archivePath"
Write-Host "Created $firefoxArchivePath"
