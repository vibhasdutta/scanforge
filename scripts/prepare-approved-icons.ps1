$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$assets = Join-Path $projectRoot 'assets'
$output = Join-Path $assets 'derived'
$sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$masters = [ordered]@{
  main = 'scanforge-main.svg'
  ready = 'Scanforge-ready.svg'
  auditing = 'scanforge-auditing.svg'
  stopping = 'scanforge-stopping.svg'
  offline = 'scanforge-offline.svg'
  error = 'scanforge-error.svg'
}

New-Item -ItemType Directory -Path $output -Force | Out-Null

function Get-EmbeddedPng([string]$svgPath) {
  $text = Get-Content -Raw -LiteralPath $svgPath
  $match = [regex]::Match($text, 'data:image/png;base64,(?<data>[^"'']+)')
  if (-not $match.Success) { throw "No embedded PNG found in $svgPath" }
  return [Convert]::FromBase64String($match.Groups['data'].Value)
}

function Export-IconPng([string]$svgPath, [int]$size, [string]$destination) {
  $bytes = Get-EmbeddedPng $svgPath
  $stream = [IO.MemoryStream]::new($bytes)
  $source = [Drawing.Image]::FromStream($stream)
  try {
    $canvas = [Drawing.Bitmap]::new(1254, 1254, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $canvas.SetResolution(96, 96)
      $graphics = [Drawing.Graphics]::FromImage($canvas)
      try {
        $graphics.Clear([Drawing.Color]::Transparent)
        $graphics.DrawImageUnscaled($source, 0, 0)
      } finally { $graphics.Dispose() }

      $target = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
      try {
        $target.SetResolution(96, 96)
        $graphics = [Drawing.Graphics]::FromImage($target)
        try {
          $graphics.Clear([Drawing.Color]::Transparent)
          $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
          $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
          $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
          $graphics.DrawImage($canvas, [Drawing.Rectangle]::new(0, 0, $size, $size), 0, 0, 1254, 1254, [Drawing.GraphicsUnit]::Pixel)
        } finally { $graphics.Dispose() }
        $target.Save($destination, [Drawing.Imaging.ImageFormat]::Png)
      } finally { $target.Dispose() }
    } finally { $canvas.Dispose() }
  } finally {
    $source.Dispose()
    $stream.Dispose()
  }
}

function Write-Ico([array]$images, [string]$destination) {
  $stream = [IO.File]::Open($destination, [IO.FileMode]::Create, [IO.FileAccess]::Write)
  $writer = [IO.BinaryWriter]::new($stream)
  try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$images.Count)
    $offset = 6 + (16 * $images.Count)
    foreach ($image in $images) {
      $encodedDimension = if ($image.Size -eq 256) { 0 } else { $image.Size }
      $writer.Write([byte]$encodedDimension)
      $writer.Write([byte]$encodedDimension)
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]32)
      $writer.Write([UInt32]$image.Bytes.Length)
      $writer.Write([UInt32]$offset)
      $offset += $image.Bytes.Length
    }
    foreach ($image in $images) { $writer.Write([byte[]]$image.Bytes) }
  } finally {
    $writer.Dispose()
    $stream.Dispose()
  }
}

function Read-SingleIco([string]$path, [int]$size) {
  $bytes = [IO.File]::ReadAllBytes($path)
  $length = [BitConverter]::ToUInt32($bytes, 14)
  $offset = [BitConverter]::ToUInt32($bytes, 18)
  $image = [byte[]]::new($length)
  [Array]::Copy($bytes, $offset, $image, 0, $length)
  return @{ Size = $size; Bytes = $image }
}

foreach ($entry in $masters.GetEnumerator()) {
  $svgPath = Join-Path $assets $entry.Value
  if (-not (Test-Path -LiteralPath $svgPath)) { throw "Missing approved icon master: $svgPath" }
  $pngs = @()
  foreach ($size in $sizes) {
    $pngPath = Join-Path $output "scanforge-$($entry.Key)-$size.png"
    Export-IconPng $svgPath $size $pngPath
    $pngs += @{ Size = $size; Bytes = [IO.File]::ReadAllBytes($pngPath) }
  }
  if ($entry.Key -ne 'main') { Write-Ico $pngs (Join-Path $output "scanforge-$($entry.Key).ico") }
}

$mainLayers = foreach ($size in $sizes) {
  $source = Join-Path $assets "scanforge-$size.ico"
  if (-not (Test-Path -LiteralPath $source)) { throw "Missing approved ICO layer: $source" }
  Read-SingleIco $source $size
}
Write-Ico $mainLayers (Join-Path $output 'scanforge.ico')

Write-Host "Prepared approved ScanForge icons in $output"
