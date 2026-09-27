# Install the version-gated asset rescan guard into the current user's Codex++ data directory.
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$CodexPlusDataRoot = (Join-Path $env:APPDATA 'Codex++')
)

$ErrorActionPreference = 'Stop'

$source = Join-Path $PSScriptRoot '00-codex-asset-rescan-guard.js'
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
  throw "Guard script not found: $source"
}

if (-not $PSCmdlet.ShouldProcess($CodexPlusDataRoot, 'Install Codex++ asset rescan guard')) {
  return
}

$userScriptsDir = Join-Path $CodexPlusDataRoot 'user_scripts'
$target = Join-Path $userScriptsDir '00-codex-asset-rescan-guard.js'
$settingsPath = Join-Path $CodexPlusDataRoot 'user_scripts.json'
$scriptKey = 'user:00-codex-asset-rescan-guard.js'

New-Item -ItemType Directory -Path $userScriptsDir -Force | Out-Null
Copy-Item -LiteralPath $source -Destination $target -Force

if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
  $backup = Join-Path $CodexPlusDataRoot ("user_scripts.json.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  Copy-Item -LiteralPath $settingsPath -Destination $backup -Force
  $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
} else {
  $settings = [pscustomobject]@{
    enabled = $true
    scripts = [pscustomobject]@{}
    market = [pscustomobject]@{}
  }
}

if (-not $settings.PSObject.Properties['enabled']) {
  $settings | Add-Member -NotePropertyName enabled -NotePropertyValue $true
} else {
  $settings.enabled = $true
}

if (-not $settings.PSObject.Properties['scripts'] -or $null -eq $settings.scripts) {
  $settings | Add-Member -NotePropertyName scripts -NotePropertyValue ([pscustomobject]@{}) -Force
}

if ($settings.scripts.PSObject.Properties[$scriptKey]) {
  $settings.scripts.$scriptKey = $true
} else {
  $settings.scripts | Add-Member -NotePropertyName $scriptKey -NotePropertyValue $true
}

$json = $settings | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($settingsPath, $json, [System.Text.UTF8Encoding]::new($false))

Write-Host "Installed: $target"
Write-Host "Enabled:   $settingsPath"
Write-Host "Restart Codex++ and Codex to reload user scripts."
