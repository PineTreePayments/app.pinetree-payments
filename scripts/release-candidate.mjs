#!/usr/bin/env node
/**
 * Offline release-candidate validation for the PineTree API and private SDKs.
 *
 * This command never publishes packages or runs credentialed integration tests.
 * Pass --dry-run to validate manifests and print the command plan only.
 */

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const node = process.execPath
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const dryRun = process.argv.includes("--dry-run")
const tsc = resolve(repoRoot, "node_modules", "typescript", "bin", "tsc")
const vitest = resolve(repoRoot, "node_modules", "vitest", "vitest.mjs")

const packages = [
  {
    name: "@pinetree/node",
    directory: "packages/pinetree-node",
    expectedDependency: null,
  },
  {
    name: "@pinetree/js",
    directory: "packages/pinetree-js",
    expectedDependency: null,
  },
  {
    name: "@pinetree/react",
    directory: "packages/pinetree-react",
    expectedDependency: {
      name: "@pinetree/js",
      value: "file:../pinetree-js",
    },
  },
]

let stepNumber = 0

function step(label) {
  stepNumber += 1
  console.log(`\n[${stepNumber}] ${label}`)
}

function fail(message) {
  console.error(`\nFAILED: ${message}`)
  process.exit(1)
}

function readManifest(packageInfo) {
  return JSON.parse(
    readFileSync(resolve(repoRoot, packageInfo.directory, "package.json"), "utf8")
  )
}

function validateManifests() {
  step("Validate private package metadata, dependencies, and exports")

  for (const packageInfo of packages) {
    const manifest = readManifest(packageInfo)
    if (manifest.name !== packageInfo.name) {
      fail(`${packageInfo.directory} has package name ${manifest.name}.`)
    }
    if (manifest.private !== true) {
      fail(`${packageInfo.name} must remain private.`)
    }

    const rootExport = manifest.exports?.["."]
    for (const field of ["main", "module", "types"]) {
      if (typeof manifest[field] !== "string" || manifest[field].length === 0) {
        fail(`${packageInfo.name} is missing ${field}.`)
      }
    }
    for (const condition of ["types", "import", "require"]) {
      if (typeof rootExport?.[condition] !== "string") {
        fail(`${packageInfo.name} is missing exports["."].${condition}.`)
      }
    }

    if (packageInfo.expectedDependency) {
      const { name, value } = packageInfo.expectedDependency
      if (manifest.dependencies?.[name] !== value) {
        fail(`${packageInfo.name} must depend on ${name} as ${value}.`)
      }
    }
  }

  const reactManifest = readManifest(packages[2])
  for (const peer of ["react", "react-dom"]) {
    if (typeof reactManifest.peerDependencies?.[peer] !== "string") {
      fail(`@pinetree/react must declare ${peer} as a peer dependency.`)
    }
  }
}

function run(label, command, args, cwd = repoRoot) {
  step(label)
  if (dryRun) {
    console.log(`DRY RUN: ${command} ${args.join(" ")}`)
    return
  }

  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: false,
  })
  if (result.status !== 0) {
    fail(`${label} exited with status ${result.status ?? "unknown"}.`)
  }
}

function packagePath(packageInfo, path) {
  return resolve(repoRoot, packageInfo.directory, path)
}

function validatePackageArchive(packageInfo) {
  step(`${packageInfo.name} npm pack --dry-run`)
  if (dryRun) {
    console.log(`DRY RUN: npm pack --dry-run --json (${packageInfo.directory})`)
    return
  }

  const result = spawnSync(`${npm} pack --dry-run --json`, {
    cwd: resolve(repoRoot, packageInfo.directory),
    encoding: "utf8",
    shell: true,
  })
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "")
    fail(`${packageInfo.name} package dry-run failed.`)
  }

  let report
  try {
    report = JSON.parse(result.stdout)
  } catch {
    fail(`${packageInfo.name} returned invalid npm pack JSON.`)
  }

  const files = report[0]?.files?.map((entry) => entry.path) ?? []
  if (files.length === 0) {
    fail(`${packageInfo.name} package archive is empty.`)
  }

  const unexpected = files.filter((file) =>
    /^(src|test|scripts)\//.test(file) ||
    /(^|\/)(tsconfig.*|vitest\.config.*|.*\.tsbuildinfo|\.env.*)$/.test(file)
  )
  if (unexpected.length > 0) {
    fail(`${packageInfo.name} archive contains unexpected files: ${unexpected.join(", ")}`)
  }

  for (const required of [
    "package.json",
    "dist/esm/index.js",
    "dist/cjs/index.js",
    "dist/types/index.d.ts",
  ]) {
    if (!files.includes(required)) {
      fail(`${packageInfo.name} archive is missing ${required}.`)
    }
  }
}

function validateUntrackedDist() {
  step("Confirm generated SDK dist files are not tracked")
  if (dryRun) {
    console.log("DRY RUN: git ls-files packages/*/dist/**")
    return
  }

  const result = spawnSync("git", ["ls-files", "packages/*/dist/**"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  })
  if (result.status !== 0) {
    fail("Unable to inspect tracked dist files.")
  }
  if (result.stdout.trim().length > 0) {
    fail(`Generated dist files are tracked:\n${result.stdout.trim()}`)
  }
}

validateManifests()
run("Root TypeScript", node, [tsc, "--noEmit"])

for (const packageInfo of packages) {
  run(
    `${packageInfo.name} typecheck`,
    node,
    [tsc, "-p", packagePath(packageInfo, "tsconfig.json"), "--noEmit"]
  )
  run(
    `${packageInfo.name} build`,
    node,
    [packagePath(packageInfo, "scripts/build.mjs")],
    resolve(repoRoot, packageInfo.directory)
  )
  run(
    `${packageInfo.name} tests`,
    node,
    [vitest, "run", "--config", packagePath(packageInfo, "vitest.config.ts")],
    resolve(repoRoot, packageInfo.directory)
  )
}

run("Full repository test suite", node, [vitest, "run"])

for (const packageInfo of packages) {
  validatePackageArchive(packageInfo)
}
validateUntrackedDist()

console.log(
  dryRun
    ? `\nRelease-candidate dry run passed (${stepNumber} checks planned).`
    : `\nRelease-candidate validation passed (${stepNumber} checks).`
)
