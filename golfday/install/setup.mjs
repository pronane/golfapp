#!/usr/bin/env node
/**
 * GolfDay local setup — the cross-platform half of the installer.
 *
 * `install.sh` (macOS/Linux) and `install.ps1` (Windows) deal with the things
 * that are genuinely OS-specific: finding or installing Node. Everything after
 * that lives here, once, so both installers behave identically:
 *
 *   node install/setup.mjs env       # create .env with a generated AUTH_SECRET
 *   node install/setup.mjs db        # create data/, apply the schema, seed the demo
 *   node install/setup.mjs scripts   # write the "start GolfDay" launchers
 *   node install/setup.mjs verify    # check everything is actually in place
 *   node install/setup.mjs start     # run the app and open a browser
 *   node install/setup.mjs all       # env + db + scripts + verify
 *
 * The database is libSQL/SQLite: a file, not a server. There is nothing to
 * install for it and nothing to start alongside the app. Point DATABASE_URL at
 * a libSQL/Turso URL instead if you outgrow the file (see docs/INSTALL.md).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, copyFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const bold = (text) => (process.stdout.isTTY ? `\u001b[1m${text}\u001b[0m` : text);
const dim = (text) => (process.stdout.isTTY ? `\u001b[90m${text}\u001b[0m` : text);
const green = (text) => (process.stdout.isTTY ? `\u001b[32m${text}\u001b[0m` : text);

const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");
const dataDir = path.join(root, "data");

/** The file-based default: no server, no credentials, no daemon to babysit. */
const DEFAULT_DATABASE_URL = "file:./data/golfday.db";

function say(message) {
  console.log(message);
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function readEnvFile() {
  if (!existsSync(envPath)) return "";
  return readFileSync(envPath, "utf8");
}

function upsertEnv(contents, key, value) {
  const line = `${key}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(contents)) return contents.replace(pattern, line);
  return `${contents.replace(/\s*$/, "")}\n${line}\n`;
}

function envValue(contents, key) {
  const match = contents.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, "");
}

/** Creates .env from the template, generating the one secret the app needs. */
function writeEnv() {
  let created = false;
  if (!existsSync(envPath)) {
    if (!existsSync(examplePath)) fail("`.env.example` is missing - is this the golfday directory?");
    copyFileSync(examplePath, envPath);
    created = true;
  }

  let contents = readEnvFile();
  const current = envValue(contents, "AUTH_SECRET");
  if (!current || current.length < 16) {
    const secret = randomBytes(48).toString("base64url");
    contents = upsertEnv(contents, "AUTH_SECRET", secret);
    say(`  ${green("generated")} AUTH_SECRET (sessions and sealed integration passwords)`);
  } else {
    say(`  ${dim("kept")} the existing AUTH_SECRET`);
  }

  if (!envValue(contents, "DATABASE_URL")) {
    contents = upsertEnv(contents, "DATABASE_URL", DEFAULT_DATABASE_URL);
    say(`  ${green("set")} DATABASE_URL=${DEFAULT_DATABASE_URL} (a local file - no database server needed)`);
  } else {
    say(`  ${dim("kept")} DATABASE_URL=${envValue(contents, "DATABASE_URL")}`);
  }

  if (!/^GOLF_ENGLAND_MODE=/m.test(contents)) {
    contents = upsertEnv(contents, "GOLF_ENGLAND_MODE", "mock");
    say(`  ${green("set")} GOLF_ENGLAND_MODE=mock (the demo handicap directory; add real credentials later)`);
  }

  writeFileSync(envPath, contents);
  say(`  ${created ? "created" : "updated"} ${path.relative(root, envPath)}`);
}

function databaseUrl() {
  return envValue(readEnvFile(), "DATABASE_URL") ?? DEFAULT_DATABASE_URL;
}

function runNode(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    fail(`\`node ${args.join(" ")}\` failed (exit ${result.status}). See the output above.`);
  }
}

/** Applies the schema (idempotent) and seeds the demo, without wiping anything. */
function buildDatabase() {
  const url = databaseUrl();
  mkdirSync(dataDir, { recursive: true });
  say(`  database: ${url}`);
  if (url.startsWith("file:")) {
    say(dim("  a local SQLite file - created now, migrated in place on every run"));
  }
  runNode(["node_modules/tsx/dist/cli.mjs", "scripts/db-push.ts"]);
  say("  schema applied (tables, indexes and later columns)");
  runNode(["node_modules/tsx/dist/cli.mjs", "scripts/seed.ts"]);
  say("  demo data seeded (courses, three golf days and the demo accounts)");
}

const START_SH = `#!/usr/bin/env bash
# Generated by install/setup.mjs - start GolfDay and open it in a browser.
set -euo pipefail
cd "$(dirname "$0")"
if [ -x ".install/node/bin/node" ]; then export PATH="$PWD/.install/node/bin:$PATH"; fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Run ./install/install.sh first." >&2
  exit 1
fi
exec node install/setup.mjs start
`;

const START_CMD = `@echo off
rem Generated by install/setup.mjs - start GolfDay and open it in a browser.
setlocal
cd /d "%~dp0"
if exist ".install\\node\\node.exe" set "PATH=%~dp0.install\\node;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Run install\\install.ps1 first.
  pause
  exit /b 1
)
node install\\setup.mjs start
if errorlevel 1 pause
`;

const START_PS1 = `# Generated by install/setup.mjs - start GolfDay and open it in a browser.
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
$localNode = Join-Path $PSScriptRoot ".install\\node\\node.exe"
if (Test-Path -LiteralPath $localNode) {
  $env:PATH = "$(Join-Path $PSScriptRoot '.install\\node');$env:PATH"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js is not installed. Run install\\install.ps1 first."
  exit 1
}
node install/setup.mjs start
`;

function writeLaunchers() {
  const files = [
    ["start-golfday.sh", START_SH, 0o755],
    ["start-golfday.command", START_SH, 0o755], // double-clickable on macOS
    ["start-golfday.cmd", START_CMD.replace(/\r?\n/g, "\r\n"), 0o644],
    ["start-golfday.ps1", START_PS1.replace(/\r?\n/g, "\r\n"), 0o644],
  ];
  for (const [name, body, mode] of files) {
    const target = path.join(root, name);
    writeFileSync(target, body);
    if (!isWindows) chmodSync(target, mode);
  }
  say(`  wrote ${files.map(([name]) => name).join(", ")}`);
  if (!isWindows) {
    say(dim("  run ./start-golfday.sh (or double-click start-golfday.command on macOS)"));
  } else {
    say(dim("  run start-golfday.cmd, or right-click start-golfday.ps1 -> Run with PowerShell"));
  }
}

function verify() {
  const problems = [];
  const major = Number(process.versions.node.split(".")[0]);
  say(`  node ${process.version} ${major >= 20 ? green("ok") : "(20 or newer is required)"}`);
  if (major < 20) problems.push("Node.js 20+ is required");

  if (!existsSync(path.join(root, "node_modules", "next"))) problems.push("dependencies are not installed (npm install)");
  else say("  dependencies installed");

  if (!existsSync(envPath)) problems.push(".env is missing");
  else {
    const secret = envValue(readEnvFile(), "AUTH_SECRET");
    if (!secret || secret.length < 16) problems.push("AUTH_SECRET is missing from .env");
    else say("  .env configured");
  }

  const url = databaseUrl();
  if (url.startsWith("file:")) {
    const file = path.resolve(root, url.replace(/^file:/, "").split("?")[0]);
    if (!existsSync(file)) problems.push(`the database file ${path.relative(root, file)} is missing (npm run db:push)`);
    else say(`  database ready (${path.relative(root, file)})`);
  } else {
    say(`  database configured as ${url}`);
  }

  if (existsSync(path.join(root, ".next", "BUILD_ID"))) say("  production build present");
  else say(dim("  no production build yet - the launcher runs the development server (npm run build for production)"));

  if (problems.length) fail(`setup is incomplete:\n  - ${problems.join("\n  - ")}`);
  say(green("  everything checks out"));
}

async function openWhenReady(port) {
  const url = `http://localhost:${port}`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) break;
    } catch {
      /* not yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (process.env.NO_BROWSER === "1") return;
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : isWindows
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    spawn(command, args, { detached: true, stdio: "ignore" }).unref();
    say(dim(`  opened ${url}`));
  } catch {
    say(dim(`  open ${url} in your browser`));
  }
}

function start() {
  if (!existsSync(envPath)) {
    say(bold("First run - preparing the database"));
    writeEnv();
    buildDatabase();
  }
  const port = Number(process.env.PORT ?? 3000);
  const built = existsSync(path.join(root, ".next", "BUILD_ID"));
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextBin)) fail("dependencies are not installed - run the installer (npm install).");

  say(bold(`\nGolfDay is starting on http://localhost:${port}\n`));
  say(dim(`  ${built ? "production build" : "development server (npm run build to make this fast)"} · Ctrl+C to stop\n`));
  const child = spawn(process.execPath, [nextBin, built ? "start" : "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PORT: String(port) },
  });
  void openWhenReady(port);
  const stop = () => {
    child.kill("SIGTERM");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => process.exit(code ?? 0));
}

function banner() {
  say(bold("\nGolfDay setup\n"));
  say(dim(`  node ${process.version} · ${process.platform}/${process.arch} · ${root}\n`));
}

function all() {
  banner();
  say(bold("1. Environment file"));
  writeEnv();
  say(bold("\n2. Database"));
  buildDatabase();
  say(bold("\n3. Start scripts"));
  writeLaunchers();
  say(bold("\n4. Checks"));
  verify();
  say(bold(green("\nGolfDay is ready.")));
  say(`  Start it with ${bold(isWindows ? "start-golfday.cmd" : "./start-golfday.sh")}, then open http://localhost:3000`);
  say(dim("  Demo accounts: admin@golfday.app / sam@golfday.app / priya@golfday.app - password golfday123"));
}

const command = process.argv[2] ?? "all";
try {
  switch (command) {
    case "env":
      writeEnv();
      break;
    case "db":
      buildDatabase();
      break;
    case "scripts":
      writeLaunchers();
      break;
    case "verify":
      banner();
      verify();
      break;
    case "start":
      start();
      break;
    case "all":
      all();
      break;
    default:
      fail(`unknown command "${command}". Try: env | db | scripts | verify | start | all`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
