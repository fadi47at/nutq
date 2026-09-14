# Publishes a nutq release to GitHub so the in-app updater can see it.
#
# The GitHub half of the release ritual, all in one command: builds the
# SIGNED installer (the signing key lives outside the repo, at
# %USERPROFILE%\.nutq\updater.key), writes latest.json describing it, pushes
# the commit and tag, and creates the GitHub Release with both files
# attached. Every installed copy reads that release through the updater
# plugin and offers the upgrade on its Home page.
#
# Run order: bump the three version files, commit, tag, then run this from
# nutq/ with:  powershell -File scripts\publish-release.ps1 -Notes "what's new"
#
# Losing the private key means no release can ever be signed again - the
# updater in installed copies would refuse it - so it stays out of the repo.

param(
  # One line for the update card; also the release body on GitHub.
  [string]$Notes = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot   # nutq/
$srcTauri = Join-Path $root "src-tauri"
$key = Join-Path $env:USERPROFILE ".nutq\updater.key"

if (-not (Test-Path -LiteralPath $key)) {
  throw "signing key not found at $key - it is kept outside the repo on purpose"
}

$conf = Get-Content (Join-Path $srcTauri "tauri.conf.json") -Raw | ConvertFrom-Json
$version = $conf.version
$tag = "v$version"

# The tag must exist locally before the push below carries it upstream.
$tagged = git tag -l $tag
if ($tagged -ne $tag) {
  throw "tag $tag does not exist yet - commit and tag before publishing"
}

# The bundler signs only when TAURI_SIGNING_PRIVATE_KEY holds the key
# itself (a path is not accepted), so read the file into the env var. The
# key has a REAL password - an empty one is treated as unset and the
# bundler prompts for it, and a prompt in a non-interactive shell hangs
# the build forever. The password lives beside the key, outside the repo.
$passFile = Join-Path $env:USERPROFILE ".nutq\updater.key.pass"
if (-not (Test-Path -LiteralPath $passFile)) {
  throw "password file not found at $passFile - it is kept outside the repo with the key"
}
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -LiteralPath $key -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content -LiteralPath $passFile -Raw).Trim()

Write-Host "building nutq $tag (signed) ..."
Push-Location $root
try {
  npm run tauri build
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
} finally {
  Pop-Location
}

$nsis = Join-Path $srcTauri "target\release\bundle\nsis"
$setup = Get-ChildItem $nsis -Filter "nutq_*_x64-setup.exe" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { throw "no setup exe found under $nsis" }
$sig = "$($setup.FullName).sig"
if (-not (Test-Path -LiteralPath $sig)) {
  throw "signature file missing: $sig - was the build actually signed?"
}

$origin = git remote get-url origin
$ownerRepo = $origin -replace '\.git$', '' -replace '^https://github\.com/', '' -replace '^git@github\.com:', ''

$latest = [ordered]@{
  version = $version
  notes = $Notes
  pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = (Get-Content -LiteralPath $sig -Raw).Trim()
      url = "https://github.com/$ownerRepo/releases/download/$tag/$($setup.Name)"
    }
  }
}
$latestPath = Join-Path $nsis "latest.json"
$latest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $latestPath -Encoding ascii

Write-Host "pushing commit and $tag ..."
git push origin HEAD
if ($LASTEXITCODE -ne 0) { throw "git push failed" }
git push origin $tag
if ($LASTEXITCODE -ne 0) { throw "git push of the tag failed" }

Write-Host "creating GitHub release $tag ..."
gh release create $tag $setup.FullName $latestPath --title "nutq $tag" --notes $Notes

# The local copy for handing to someone, one folder away from the source -
# part of the ritual, so the script owns it rather than memory.
$versionsDir = Join-Path (Split-Path -Parent $root) "versions"
New-Item -ItemType Directory -Path $versionsDir -Force | Out-Null
Copy-Item -LiteralPath $setup.FullName -Destination $versionsDir -Force

Write-Host ""
Write-Host "published: https://github.com/$ownerRepo/releases/tag/$tag"
Write-Host "installer copied to: $versionsDir"
