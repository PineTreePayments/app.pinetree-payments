#!/usr/bin/env node
/**
 * SDK release-candidate validation.
 *
 * Runs the full pre-release checklist without publishing or hitting live APIs.
 * Exits non-zero on the first failure.
 *
 *   1. SDK typecheck
 *   2. SDK build (ESM + CJS + declarations + consumer type check)
 *   3. SDK offline unit tests
 *   4. Integration guard tests  (environment.test.ts, no credentials required)
 *   5. npm pack --dry-run
 *   6. Generated-file leak check (src/, test/, scripts/, tsconfigs, env files)
 *   7. dist/ not committed to git
 */

import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = resolve(packageRoot, "..", "..")
const node = process.execPath
const isWin = process.platform === "win32"

const vitestBin = resolve(repoRoot, "node_modules", "vitest", "vitest.mjs")
const tscBin = resolve(repoRoot, "node_modules", "typescript", "bin", "tsc")
const npm = isWin ? "npm.cmd" : "npm"

let stepNum = 0

function step(label) {
  stepNum++
  console.log(`\n[${stepNum}] ${label}`)
}

function run(label, cmd, args, opts = {}) {
  step(label)
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? packageRoot,
    env: opts.env ?? process.env,
    stdio: "inherit",
    shell: false,
  })
  if (result.status !== 0) {
    console.error(`\n    FAILED — exited ${result.status}`)
    process.exit(result.status ?? 1)
  }
}

// ── 1. Typecheck ────────────────────────────────────────────────────────────
run("SDK typecheck", node, [tscBin, "-p", "tsconfig.json", "--noEmit"])

// ── 2. Build ────────────────────────────────────────────────────────────────
run("SDK build (ESM + CJS + declarations + consumer type check)", node, [
  "./scripts/build.mjs",
])

// ── 3. Offline unit tests ────────────────────────────────────────────────────
run("SDK offline unit tests", node, [
  vitestBin,
  "run",
  "--config",
  "vitest.config.ts",
  "--reporter=verbose",
])

// ── 4. Integration guard tests ───────────────────────────────────────────────
// Runs environment.test.ts only — no PINETREE_RUN_INTEGRATION or API credentials
// needed.  These tests verify that the integration safety guards reject
// unconfigured or mis-configured environments, not that the API is reachable.
const guardEnv = { ...process.env }
delete guardEnv.PINETREE_RUN_INTEGRATION
delete guardEnv.PINETREE_INTEGRATION_API_KEY
delete guardEnv.PINETREE_INTEGRATION_WEBHOOK_SECRET
delete guardEnv.PINETREE_INTEGRATION_BASE_URL
delete guardEnv.PINETREE_ALLOW_PRODUCTION_INTEGRATION

run(
  "Integration guard tests (no credentials)",
  node,
  [
    vitestBin,
    "run",
    "--config",
    "vitest.integration.config.ts",
    "--reporter=verbose",
    "test/integration/environment.test.ts",
  ],
  { env: guardEnv }
)

// ── 5 + 6. npm pack --dry-run + generated-file leak check ───────────────────
step("npm pack --dry-run + generated-file leak check")
// shell: true is required on Windows so that .cmd wrappers (npm.cmd) execute.
// Pass as a single command string (not args array) to avoid the Node v24
// DEP0190 warning about unescaped args with shell:true.
const packResult = spawnSync(`${npm} pack --dry-run`, {
  cwd: packageRoot,
  stdio: ["ignore", "pipe", "pipe"],
  shell: true,
})
if (packResult.error || packResult.stdout === null) {
  console.error(`\n    FAILED — could not spawn npm: ${packResult.error?.message ?? "spawn returned null"}`)
  process.exit(1)
}
// npm v7+ prints the file listing on stderr as "npm notice" lines.
// Older npm prints on stdout.  Check both.
const packOutput = packResult.stdout.toString() + packResult.stderr.toString()
process.stdout.write(packOutput)

if (packResult.status !== 0) {
  console.error(`\n    FAILED — npm pack exited ${packResult.status}`)
  process.exit(1)
}

const LEAK_PATTERNS = [
  { re: /\bsrc\//, label: "source files (src/)" },
  { re: /\btest\//, label: "test files (test/)" },
  { re: /\bscripts\//, label: "build scripts (scripts/)" },
  { re: /tsconfig/, label: "tsconfig files" },
  { re: /vitest\.config/, label: "vitest config" },
  { re: /consumer-check/, label: "consumer type-check temp file" },
  { re: /\.tsbuildinfo/, label: "TypeScript build-info cache" },
  { re: /\.env/, label: "env files" },
]

const leaks = []
for (const line of packOutput.split(/\r?\n/)) {
  for (const { re, label } of LEAK_PATTERNS) {
    if (re.test(line)) {
      leaks.push(`  ${label}: ${line.trim()}`)
    }
  }
}

if (leaks.length > 0) {
  console.error(`\n    FAILED — package contains unexpected files:`)
  for (const leak of leaks) console.error(leak)
  process.exit(1)
}

// ── 7. dist/ not committed to git ───────────────────────────────────────────
step("dist/ must not be committed to git")
const gitCheck = spawnSync("git", ["ls-files", "packages/pinetree-node/dist"], {
  cwd: repoRoot,
  stdio: ["ignore", "pipe", "pipe"],
  shell: false,
})
const trackedDist = gitCheck.stdout.toString().trim()
if (trackedDist.length > 0) {
  console.error(`\n    FAILED — dist/ files are tracked by git (run git rm -r --cached):`)
  console.error(trackedDist)
  process.exit(1)
}

// ── Done ─────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`)
console.log(`All ${stepNum} release-candidate checks passed.`)
console.log(`${"─".repeat(60)}\n`)
