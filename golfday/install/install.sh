#!/usr/bin/env bash
#
# GolfDay installer for macOS and Linux.
#
#   ./install/install.sh                 install everything, then prove it works
#   ./install/install.sh --skip-e2e      install without the browser click-through
#   ./install/install.sh --no-build      skip the production build (dev server only)
#
# What it does, in order:
#
#   1. finds Node.js 20+ (uses the one you have, otherwise downloads a private
#      copy into .install/node - no sudo, nothing system-wide is touched);
#   2. installs the app's dependencies;
#   3. creates .env with a generated AUTH_SECRET and a file database -- there is
#      no database server to install, libSQL/SQLite is a single file;
#   4. applies the schema and seeds the demo data;
#   5. writes the start launchers (./start-golfday.sh, .command, .cmd, .ps1);
#   6. installs a headless Chromium for the end-to-end run (best effort);
#   7. builds, then drives a real browser through a whole golf day.
#
# Safe to re-run: it never overwrites .env, never wipes your database, and the
# end-to-end run uses its own throwaway database file.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NODE_MAJOR_REQUIRED=20
NODE_VERSION="${GOLFDAY_NODE_VERSION:-22.11.0}"
SKIP_E2E=0
NO_BUILD=0
FORCE_NODE=0

for arg in "$@"; do
  case "$arg" in
    --skip-e2e) SKIP_E2E=1 ;;
    --skip-browsers) SKIP_BROWSERS_ARG=1 ;;
    --no-build) NO_BUILD=1 ;;
    --force-node) FORCE_NODE=1 ;;
    -h|--help)
      sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"; DIM="$(printf '\033[90m')"; GREEN="$(printf '\033[32m')"
  RED="$(printf '\033[31m')"; OFF="$(printf '\033[0m')"
else
  BOLD=""; DIM=""; GREEN=""; RED=""; OFF=""
fi

step() { printf '\n%s%s%s\n' "$BOLD" "$1" "$OFF"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$OFF"; }
die()  { printf '\n%s✗ %s%s\n\n' "$RED" "$1" "$OFF" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

node_major() {
  "$1" -v 2>/dev/null | sed 's/^v//' | cut -d. -f1
}

download() {
  # download <url> <destination>
  if have curl; then
    curl -fsSL --retry 3 --connect-timeout 20 -o "$2" "$1"
  elif have wget; then
    wget -q -O "$2" "$1"
  else
    die "Neither curl nor wget is available, so Node.js cannot be downloaded. Install one of them and re-run."
  fi
}

platform_tag() {
  local os arch
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *) die "Unsupported operating system: $(uname -s). On Windows run install\\install.ps1 instead." ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    armv7l) arch="armv7l" ;;
    ppc64le) arch="ppc64le" ;;
    s390x) arch="s390x" ;;
    *) die "Unsupported CPU architecture: $(uname -m)" ;;
  esac
  printf '%s-%s' "$os" "$arch"
}

install_node() {
  local tag="node-v${NODE_VERSION}-$(platform_tag)"

  # Alpine and other musl systems have no official build; use the package manager.
  if [ -f /etc/alpine-release ]; then
    note "Alpine Linux detected - using apk for Node.js"
    if have apk; then
      if [ "$(id -u)" -eq 0 ]; then apk add --no-cache nodejs npm
      elif have sudo; then sudo apk add --no-cache nodejs npm
      else die "Node.js is missing and installing it needs root here (apk add nodejs npm)."; fi
      return 0
    fi
    die "Node.js is missing and apk is not available."
  fi

  say_download() { note "downloading $1"; }

  mkdir -p .install
  local tmpdir
  tmpdir="$(mktemp -d)"
  local archive="$tmpdir/$tag.tar.gz"

  say_download "https://nodejs.org/dist/v${NODE_VERSION}/${tag}.tar.gz"
  download "https://nodejs.org/dist/v${NODE_VERSION}/${tag}.tar.gz" "$archive"

  # Verify against the published checksums when we can get them.
  if download "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" "$tmpdir/SHASUMS256.txt" 2>/dev/null; then
    local expected actual
    expected="$(grep " ${tag}.tar.gz\$" "$tmpdir/SHASUMS256.txt" | awk '{print $1}' || true)"
    if [ -n "$expected" ]; then
      if have sha256sum; then actual="$(sha256sum "$archive" | awk '{print $1}')"
      else actual="$(shasum -a 256 "$archive" | awk '{print $1}')"; fi
      [ "$expected" = "$actual" ] || die "The Node.js download failed its checksum check. Try again, or install Node.js 20+ yourself."
      ok "download verified (SHA-256)"
    fi
  fi

  rm -rf .install/node
  tar -xzf "$archive" -C "$tmpdir"
  mv "$tmpdir/$tag" .install/node
  rm -rf "$tmpdir"
  ok "Node.js ${NODE_VERSION} installed into .install/node (private to this folder)"
}

# ---------------------------------------------------------------------------

printf '%sGolfDay installer%s\n' "$BOLD" "$OFF"
note "$(uname -s) $(uname -m) · $ROOT"

step "1. Node.js"
NODE_BIN=""
if [ -x ".install/node/bin/node" ]; then
  NODE_BIN="$ROOT/.install/node/bin/node"
  note "found the private copy in .install/node"
elif have node; then
  NODE_BIN="$(command -v node)"
fi

if [ "$FORCE_NODE" -eq 1 ]; then
  install_node
  NODE_BIN="$ROOT/.install/node/bin/node"
elif [ -n "$NODE_BIN" ]; then
  major="$(node_major "$NODE_BIN")"
  if [ "${major:-0}" -lt "$NODE_MAJOR_REQUIRED" ]; then
    note "node $("$NODE_BIN" -v) is too old (20+ needed) - installing a private copy"
    install_node
    NODE_BIN="$ROOT/.install/node/bin/node"
  fi
else
  note "Node.js is not installed"
  install_node
  NODE_BIN="$ROOT/.install/node/bin/node"
fi

export PATH="$(dirname "$NODE_BIN"):$PATH"
[ -x "$NODE_BIN" ] || die "No usable Node.js found."
ok "node $("$NODE_BIN" -v) · npm $(npm -v 2>/dev/null || echo '?')"

step "2. Application dependencies"
if [ -f package-lock.json ] && have npm; then
  note "npm ci (exactly the versions in package-lock.json)"
  npm ci --no-audit --no-fund || npm install --no-audit --no-fund
else
  note "npm install"
  npm install --no-audit --no-fund
fi
ok "dependencies installed"

step "3-5. Environment, database and launchers"
"$NODE_BIN" install/setup.mjs all

if [ "${SKIP_BROWSERS_ARG:-0}" -eq 1 ]; then
  step "6. Headless browser"
  note "skipped (--skip-browsers)"
else
  step "6. Headless browser for the end-to-end run"
  if [ -f node_modules/playwright-core/cli.js ]; then
    if "$NODE_BIN" node_modules/playwright-core/cli.js install chromium >/tmp/golfday-browser.log 2>&1; then
      ok "Chromium ready for the click-through"
    else
      note "could not download Chromium (no internet, or a proxy) - the end-to-end run will use Chrome or Edge if installed"
    fi
  else
    note "playwright-core is not installed - skipping the browser download"
  fi
fi

if [ "$NO_BUILD" -eq 1 ]; then
  step "7. Production build"
  note "skipped (--no-build) - the launcher will use the development server"
else
  step "7. Production build"
  note "next build - this takes a minute"
  npm run build
  ok "build complete"
fi

E2E_STATUS="skipped"
if [ "$SKIP_E2E" -eq 1 ]; then
  step "8. End-to-end click-through"
  note "skipped (--skip-e2e)"
else
  step "8. End-to-end click-through"
  note "a real browser registering, running a golf day and scoring a card"
  note "then a second run for a friends' day with no society and cash on the day"
  if npm run e2e && npm run e2e:friends; then
    E2E_STATUS="passed"
    ok "both journeys work on this machine"
  else
    E2E_STATUS="failed"
    printf '  %sThe click-through failed.%s The app is installed and will start normally;\n' "$RED" "$OFF"
    printf '  screenshots of the failing step are in e2e/artifacts/.\n'
  fi
fi

step "Done"
printf '  %sGolfDay is installed in %s%s\n' "$GREEN" "$ROOT" "$OFF"
printf '  Start it:  %s./start-golfday.sh%s   (macOS: double-click start-golfday.command)\n' "$BOLD" "$OFF"
printf '  Then open: %shttp://localhost:3000%s\n' "$BOLD" "$OFF"
printf '  Sign in:   admin@golfday.app / golfday123  (organiser)\n'
printf '             sam@golfday.app   / golfday123  (player)\n'
printf '  End-to-end check: %s (npm run e2e)\n' "$E2E_STATUS"

if [ "$E2E_STATUS" = "failed" ]; then
  exit 1
fi
