<#
  GolfDay installer for Windows (PowerShell 5.1 or PowerShell 7+).

    powershell -ExecutionPolicy Bypass -File install\install.ps1
    powershell -ExecutionPolicy Bypass -File install\install.ps1 -SkipE2E
    powershell -ExecutionPolicy Bypass -File install\install.ps1 -NoBuild

  What it does, in order:

    1. finds Node.js 20+ (uses the one you have, otherwise installs it with
       winget, or downloads a private copy into .install\node - no admin rights
       and nothing system-wide is changed);
    2. installs the app's dependencies;
    3. creates .env with a generated AUTH_SECRET and a file database - there is
       no database server to install, libSQL/SQLite is a single file;
    4. applies the schema and seeds the demo data;
    5. writes the start launchers (start-golfday.cmd, start-golfday.ps1);
    6. installs a headless Chromium for the end-to-end run (best effort);
    7. builds, then drives a real browser through a whole golf day.

  Safe to re-run: it never overwrites .env, never wipes your database, and the
  end-to-end run uses its own throwaway database file.
#>
[CmdletBinding()]
param(
  [switch]$SkipE2E,
  [switch]$SkipBrowsers,
  [switch]$NoBuild,
  [switch]$ForceNode,
  [string]$NodeVersion = "22.11.0"
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

function Write-Step([string]$Text) { Write-Host "`n$Text" -ForegroundColor White }
function Write-Ok([string]$Text) { Write-Host "  [ok] $Text" -ForegroundColor Green }
function Write-Note([string]$Text) { Write-Host "  $Text" -ForegroundColor DarkGray }
function Stop-Install([string]$Text) {
  Write-Host "`n[error] $Text`n" -ForegroundColor Red
  exit 1
}

function Test-Command([string]$Name) { return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

function Get-NodeMajor([string]$Exe) {
  try {
    $version = (& $Exe -v) 2>$null
    if (-not $version) { return 0 }
    return [int](($version -replace "^v", "").Split(".")[0])
  } catch {
    return 0
  }
}

function Update-PathFromRegistry {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:PATH = "$machine;$user"
}

function Get-WindowsArch {
  $arch = $env:PROCESSOR_ARCHITECTURE
  if ($env:PROCESSOR_ARCHITEW6432) { $arch = $env:PROCESSOR_ARCHITEW6432 }
  switch ($arch.ToUpper()) {
    "AMD64" { return "x64" }
    "ARM64" { return "arm64" }
    "X86" { return "x86" }
    default { Stop-Install "Unsupported CPU architecture: $arch" }
  }
}

function Install-Node {
  $arch = Get-WindowsArch
  $tag = "node-v$NodeVersion-win-$arch"

  # winget first: it puts Node where the whole machine expects it.
  if (Test-Command "winget") {
    Write-Note "installing Node.js LTS with winget"
    & winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-source-agreements --accept-package-agreements | Out-Null
    Update-PathFromRegistry
    if (Test-Command "node") {
      if ((Get-NodeMajor "node") -ge 20) {
        Write-Ok "node $(& node -v) installed with winget"
        return
      }
    }
    Write-Note "winget did not produce a usable node - downloading a private copy instead"
  }

  # Otherwise: a private copy inside the repo. No admin rights needed.
  Write-Note "downloading https://nodejs.org/dist/v$NodeVersion/$tag.zip"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $tmp = Join-Path $env:TEMP ("golfday-node-" + [guid]::NewGuid().ToString("n"))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  $zip = Join-Path $tmp "$tag.zip"

  try {
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/$tag.zip" -OutFile $zip -UseBasicParsing
  } catch {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    Stop-Install "Could not download Node.js. Install the LTS from https://nodejs.org and re-run this script."
  }

  # Verify against the published checksums when we can get them.
  $expected = $null
  try {
    $sums = Join-Path $tmp "SHASUMS256.txt"
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -OutFile $sums -UseBasicParsing
    $line = (Select-String -Path $sums -SimpleMatch " $tag.zip" | Select-Object -First 1).Line
    if ($line) { $expected = ($line -split "\s+")[0] }
  } catch {
    $expected = $null
  }
  if ($expected) {
    $actual = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLower()
    if ($expected.ToLower() -ne $actual) {
      Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
      Stop-Install "The Node.js download failed its checksum check. Try again, or install Node.js 20+ yourself."
    }
    Write-Ok "download verified (SHA-256)"
  }

  $install = Join-Path (Get-Location) ".install"
  New-Item -ItemType Directory -Path $install -Force | Out-Null
  $target = Join-Path $install "node"
  if (Test-Path -LiteralPath $target) { Remove-Item -Recurse -Force $target }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  Move-Item -LiteralPath (Join-Path $tmp $tag) -Destination $target
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  $env:PATH = "$target;$env:PATH"
  Write-Ok "Node.js $NodeVersion installed into .install\node (private to this folder)"
}

# ---------------------------------------------------------------------------

Write-Host "GolfDay installer" -ForegroundColor White
Write-Note "$([Environment]::OSVersion.VersionString) · $(Get-Location)"

Write-Step "1. Node.js"
$localNode = Join-Path (Get-Location) ".install\node\node.exe"
if ($ForceNode) {
  Install-Node
} elseif (Test-Path -LiteralPath $localNode) {
  $env:PATH = "$(Split-Path -Parent $localNode);$env:PATH"
  Write-Note "using the private copy in .install\node"
} elseif (Test-Command "node") {
  if ((Get-NodeMajor "node") -lt 20) {
    Write-Note "node $(& node -v) is too old (20+ needed) - installing a newer one"
    Install-Node
  }
} else {
  Write-Note "Node.js is not installed"
  Install-Node
}

if (Test-Path -LiteralPath $localNode) { $env:PATH = "$(Split-Path -Parent $localNode);$env:PATH" }
if (-not (Test-Command "node")) { Stop-Install "No usable Node.js found." }
if ((Get-NodeMajor "node") -lt 20) { Stop-Install "Node.js 20 or newer is required (found $(& node -v))." }
Write-Ok "node $(& node -v) · npm $(npm -v)"

Write-Step "2. Application dependencies"
if (Test-Path "package-lock.json") {
  Write-Note "npm ci (exactly the versions in package-lock.json)"
  & npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { & npm install --no-audit --no-fund }
} else {
  Write-Note "npm install"
  & npm install --no-audit --no-fund
}
if ($LASTEXITCODE -ne 0) { Stop-Install "npm could not install the dependencies (see the output above)." }
Write-Ok "dependencies installed"

Write-Step "3-5. Environment, database and launchers"
& node install/setup.mjs all
if ($LASTEXITCODE -ne 0) { Stop-Install "The setup step failed (see the output above)." }

if ($SkipBrowsers) {
  Write-Step "6. Headless browser"
  Write-Note "skipped (-SkipBrowsers)"
} else {
  Write-Step "6. Headless browser for the end-to-end run"
  if (Test-Path "node_modules\playwright-core\cli.js") {
    & node node_modules/playwright-core/cli.js install chromium 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Ok "Chromium ready for the click-through"
    } else {
      Write-Note "could not download Chromium (no internet, or a proxy) - the run will use Chrome or Edge if installed"
    }
  } else {
    Write-Note "playwright-core is not installed - skipping the browser download"
  }
}

if ($NoBuild) {
  Write-Step "7. Production build"
  Write-Note "skipped (-NoBuild) - the launcher will use the development server"
} else {
  Write-Step "7. Production build"
  Write-Note "next build - this takes a minute"
  & npm run build
  if ($LASTEXITCODE -ne 0) { Stop-Install "The production build failed (see the output above)." }
  Write-Ok "build complete"
}

$e2eStatus = "skipped"
if ($SkipE2E) {
  Write-Step "8. End-to-end click-through"
  Write-Note "skipped (-SkipE2E)"
} else {
  Write-Step "8. End-to-end click-through"
  Write-Note "a real browser registering, running a golf day and scoring a card"
  Write-Note "then a second run for a friends' day with no society and cash on the day"
  & npm run e2e
  $first = $LASTEXITCODE
  if ($first -eq 0) { & npm run e2e:friends }
  if ($first -eq 0 -and $LASTEXITCODE -eq 0) {
    $e2eStatus = "passed"
    Write-Ok "both journeys work on this machine"
  } else {
    $e2eStatus = "failed"
    Write-Host "  The click-through failed." -ForegroundColor Red
    Write-Host "  The app is installed and will start normally; screenshots of the failing step are in e2e\artifacts."
  }
}

Write-Step "Done"
Write-Host "  GolfDay is installed in $(Get-Location)" -ForegroundColor Green
Write-Host "  Start it:  start-golfday.cmd   (or right-click start-golfday.ps1 -> Run with PowerShell)"
Write-Host "  Then open: http://localhost:3000"
Write-Host "  Sign in:   admin@golfday.app / golfday123  (organiser)"
Write-Host "             sam@golfday.app   / golfday123  (player)"
Write-Host "  End-to-end check: $e2eStatus (npm run e2e)"

if ($e2eStatus -eq "failed") { exit 1 }
