#!/usr/bin/env node
/**
 * Package the WooCommerce PineTree plugin into a distributable zip.
 *
 * Output: artifacts/woocommerce/pinetree-woocommerce.zip
 *
 * Excluded:
 *   - tests/
 *   - hidden files and directories (.*)
 *   - node_modules/
 *   - *.log, *.tsbuildinfo, *~
 *
 * Usage:
 *   node scripts/package-woocommerce-plugin.mjs
 *   node scripts/package-woocommerce-plugin.mjs --dry-run
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const repoRoot = resolve(__dirname, "..")
const pluginSrc = join(repoRoot, "plugins", "woocommerce-pinetree")
const artifactDir = join(repoRoot, "artifacts", "woocommerce")
const outputZip = join(artifactDir, "pinetree-woocommerce.zip")
const pluginFolderName = "pinetree-woocommerce"
const dryRun = process.argv.includes("--dry-run")
const isWin = process.platform === "win32"

const EXCLUDE_NAMES = new Set(["tests", "node_modules", ".git"])
const EXCLUDE_PATTERNS = [/^\./, /\.log$/, /\.tsbuildinfo$/, /~$/]

function shouldExclude(name) {
  if (EXCLUDE_NAMES.has(name)) return true
  return EXCLUDE_PATTERNS.some((p) => p.test(name))
}

function walkCopy(src, dest) {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (shouldExclude(entry.name)) continue
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      walkCopy(srcPath, destPath)
    } else {
      cpSync(srcPath, destPath)
    }
  }
}

// ── Header ───────────────────────────────────────────────────────────────────

console.log("PineTree WooCommerce Plugin Packager")
console.log(`  Source:  ${relative(repoRoot, pluginSrc)}`)
console.log(`  Output:  ${relative(repoRoot, outputZip)}`)
if (dryRun) console.log("  (dry run — no files will be written)")
console.log("")

// ── Validate source exists ───────────────────────────────────────────────────

if (!existsSync(pluginSrc)) {
  console.error(`FAIL  Plugin source not found: ${relative(repoRoot, pluginSrc)}`)
  process.exit(1)
}

const rootFile = join(pluginSrc, "woocommerce-pinetree.php")
if (!existsSync(rootFile)) {
  console.error("FAIL  woocommerce-pinetree.php not found in plugin source")
  process.exit(1)
}

// ── Dry run ───────────────────────────────────────────────────────────────────

if (dryRun) {
  console.log("ok  Plugin source found: woocommerce-pinetree.php")
  console.log("ok  Would copy plugin to staging directory, excluding:")
  console.log("      tests/, .* hidden files, node_modules/, *.log, *.tsbuildinfo")
  console.log(`ok  Would zip staging/${pluginFolderName}/ → ${relative(repoRoot, outputZip)}`)
  console.log("ok  Would validate zip contains woocommerce-pinetree.php")
  console.log("")
  console.log("Dry run complete.")
  process.exit(0)
}

// ── Stage filtered files ─────────────────────────────────────────────────────

const stagingDir = join(repoRoot, ".wc-plugin-staging")
const stagingPlugin = join(stagingDir, pluginFolderName)

if (existsSync(stagingDir)) {
  rmSync(stagingDir, { recursive: true, force: true })
}

walkCopy(pluginSrc, stagingPlugin)
mkdirSync(artifactDir, { recursive: true })

// ── Zip ───────────────────────────────────────────────────────────────────────

if (existsSync(outputZip)) {
  rmSync(outputZip)
}

if (isWin) {
  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Compress-Archive -Path "${stagingPlugin}" -DestinationPath "${outputZip}"`,
    ],
    { stdio: "inherit", shell: false }
  )
  if (result.status !== 0) {
    rmSync(stagingDir, { recursive: true, force: true })
    console.error("FAIL  Compress-Archive failed")
    process.exit(result.status ?? 1)
  }
} else {
  const result = spawnSync("zip", ["-r", outputZip, pluginFolderName], {
    cwd: stagingDir,
    stdio: "inherit",
    shell: false,
  })
  if (result.status !== 0) {
    rmSync(stagingDir, { recursive: true, force: true })
    console.error("FAIL  zip command failed. Install zip: sudo apt-get install zip")
    process.exit(result.status ?? 1)
  }
}

rmSync(stagingDir, { recursive: true, force: true })

// ── Validate output ───────────────────────────────────────────────────────────

const zipStat = statSync(outputZip)
if (zipStat.size < 5000) {
  console.error("FAIL  Generated zip is unexpectedly small — packaging may have failed")
  process.exit(1)
}

console.log(`ok  Created ${relative(repoRoot, outputZip)} (${(zipStat.size / 1024).toFixed(1)} KB)`)

if (!isWin) {
  const listResult = spawnSync("unzip", ["-l", outputZip], {
    stdio: ["ignore", "pipe", "pipe"],
  })
  const listing = listResult.stdout?.toString() ?? ""

  if (!listing.includes("woocommerce-pinetree.php")) {
    console.error("FAIL  Root plugin file not found in zip contents")
    process.exit(1)
  }

  if (listing.includes("/tests/")) {
    console.error("FAIL  Tests directory was included in zip — exclusion failed")
    process.exit(1)
  }

  console.log("ok  Zip contents validated")
}

console.log("")
console.log("Package complete.")
