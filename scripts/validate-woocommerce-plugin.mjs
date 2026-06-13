#!/usr/bin/env node
/**
 * Validation script for the WooCommerce PineTree plugin.
 *
 * Checks (in order):
 *   1. PHP available (skip PHP steps gracefully if not)
 *   2. PHP syntax — php -l on every .php file in the plugin
 *   3. No hardcoded secrets — grep for pt_live_, pk_live_, whsec_ literals
 *   4. PHP test suite — php tests/run.php
 *
 * Usage:  node scripts/validate-woocommerce-plugin.mjs [--dry-run]
 */

import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { resolve, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const repoRoot  = resolve(__dirname, "..")
const pluginDir = join(repoRoot, "plugins", "woocommerce-pinetree")
const dryRun    = process.argv.includes("--dry-run")

let stepCount  = 0
let failCount  = 0

function step(label) {
  console.log(`\n[${++stepCount}] ${label}`)
}

function pass(msg) {
  console.log(`    ok  ${msg}`)
}

function fail(msg) {
  console.error(`    FAIL  ${msg}`)
  failCount++
}

function run(label, cmd, args, opts = {}) {
  step(label)
  if (dryRun) {
    console.log(`    DRY RUN: ${cmd} ${args.join(" ")}`)
    return ""
  }
  try {
    const out = execFileSync(cmd, args, {
      encoding: "utf8",
      cwd: opts.cwd ?? repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    })
    if (out.trim()) process.stdout.write("    " + out.trim().replace(/\n/g, "\n    ") + "\n")
    return out
  } catch (err) {
    const msg = (err.stdout ?? "") + (err.stderr ?? "") || err.message
    fail(msg.trim())
    return null
  }
}

// ---------------------------------------------------------------------------
// Collect all .php files in the plugin
// ---------------------------------------------------------------------------

function collectPhpFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectPhpFiles(full))
    } else if (entry.isFile() && entry.name.endsWith(".php")) {
      files.push(full)
    }
  }
  return files
}

// ---------------------------------------------------------------------------
// 1. Detect PHP
// ---------------------------------------------------------------------------

step("Detect PHP runtime")

let phpBin = null
const phpCandidates = ["php", "php8", "php8.2", "php8.1", "php8.0"]

if (!dryRun) {
  for (const candidate of phpCandidates) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "pipe", encoding: "utf8" })
      phpBin = candidate
      break
    } catch {
      // try next
    }
  }

  if (phpBin) {
    pass(`PHP found: ${phpBin}`)
  } else {
    console.log("    SKIP  PHP not found in PATH — skipping PHP syntax, secret scan via PHP, and test suite.")
    console.log("           Install PHP 8+ and re-run to get full validation.")
  }
} else {
  console.log("    DRY RUN: would detect PHP")
  phpBin = "php" // assume available in dry-run for step display
}

// ---------------------------------------------------------------------------
// 2. PHP syntax check
// ---------------------------------------------------------------------------

const phpFiles = collectPhpFiles(pluginDir)

step(`PHP syntax check (${phpFiles.length} files)`)

if (dryRun) {
  for (const f of phpFiles) {
    console.log(`    DRY RUN: php -l ${relative(repoRoot, f)}`)
  }
} else if (!phpBin) {
  console.log("    SKIP  (PHP not available)")
} else {
  let allClean = true
  for (const phpFile of phpFiles) {
    try {
      execFileSync(phpBin, ["-l", phpFile], { stdio: "pipe", encoding: "utf8" })
    } catch (err) {
      const out = (err.stdout ?? "") + (err.stderr ?? "")
      fail(`Syntax error in ${relative(repoRoot, phpFile)}:\n    ${out.trim()}`)
      allClean = false
    }
  }
  if (allClean) {
    pass(`All ${phpFiles.length} PHP files pass syntax check`)
  }
}

// ---------------------------------------------------------------------------
// 3. No hardcoded secrets
// ---------------------------------------------------------------------------

step("Scan for hardcoded secrets in plugin PHP files")

// Patterns that should never appear in committed PHP source
const SECRET_PATTERNS = [
  /pt_live_[0-9a-f]{10,}/i,   // real secret key
  /pk_live_[0-9a-f]{10,}/i,   // real public key
  /whsec_[0-9a-f]{10,}/i,     // real webhook secret
  /pt_test_[0-9a-f]{10,}/i,   // real test key
]

if (dryRun) {
  console.log("    DRY RUN: would grep for hardcoded secrets")
} else {
  let foundSecrets = false
  for (const phpFile of phpFiles) {
    const source = readFileSync(phpFile, "utf8")
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(source)) {
        fail(`Possible hardcoded secret matching ${pattern} found in ${relative(repoRoot, phpFile)}`)
        foundSecrets = true
      }
    }
  }
  if (!foundSecrets) {
    pass("No hardcoded secrets found")
  }
}

// ---------------------------------------------------------------------------
// 4. PHP test suite
// ---------------------------------------------------------------------------

const testRunnerPath = join(pluginDir, "tests", "run.php")

step("PHP test suite")

if (dryRun) {
  console.log(`    DRY RUN: ${phpBin} ${relative(repoRoot, testRunnerPath)}`)
} else if (!phpBin) {
  console.log("    SKIP  (PHP not available)")
} else {
  try {
    const out = execFileSync(phpBin, [testRunnerPath], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    })
    // Print summary line
    const summary = out.split("\n").find(l => l.startsWith("# Results:")) ?? out.trim()
    pass(summary)
  } catch (err) {
    const out = (err.stdout ?? "") + (err.stderr ?? "")
    // Extract failing lines for concise output
    const lines = out.split("\n")
    const notOk = lines.filter(l => l.startsWith("not ok"))
    const summary = lines.find(l => l.startsWith("# Results:")) ?? ""
    fail(`PHP tests failed:\n    ${summary}\n    ${notOk.slice(0, 10).join("\n    ")}`)
  }
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

console.log("")
if (failCount === 0) {
  console.log(`WooCommerce plugin validation passed (${stepCount} checks).`)
  process.exit(0)
} else {
  console.error(`WooCommerce plugin validation FAILED — ${failCount} check(s) failed.`)
  process.exit(1)
}
