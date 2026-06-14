#!/usr/bin/env node
/**
 * Build script for @pinetreepayments/js.
 * Produces ESM, CJS, and TypeScript declaration outputs in dist/.
 * Runs a consumer type-check using the published package exports.
 */

import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, extname, join, relative, resolve } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const dist = join(packageRoot, "dist")
const tsc = resolve(packageRoot, "..", "..", "node_modules", "typescript", "bin", "tsc")

rmSync(dist, { recursive: true, force: true })

for (const config of ["tsconfig.esm.json", "tsconfig.cjs.json", "tsconfig.types.json"]) {
  execFileSync(process.execPath, [tsc, "-p", join(packageRoot, config)], {
    cwd: packageRoot,
    stdio: "inherit",
  })
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

function addJavaScriptExtensions(source) {
  return source.replace(
    /(from\s+["']|import\s*\(\s*["'])(\.\.?\/[^"']+?)(["'])/g,
    (match, prefix, specifier, suffix) =>
      /\.[a-z0-9]+$/i.test(specifier)
        ? match
        : `${prefix}${specifier}.js${suffix}`
  )
}

for (const file of walk(join(dist, "esm"))) {
  if (extname(file) !== ".js") continue
  const source = readFileSync(file, "utf8")
  writeFileSync(file, addJavaScriptExtensions(source))
}

for (const file of walk(join(dist, "types"))) {
  if (!file.endsWith(".d.ts")) continue
  const source = readFileSync(file, "utf8")
  writeFileSync(file, addJavaScriptExtensions(source))
}

for (const [directory, type] of [
  [join(dist, "esm"), "module"],
  [join(dist, "cjs"), "commonjs"],
]) {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, "package.json"), `${JSON.stringify({ type }, null, 2)}\n`)
}

// Verify the generated entry points export PineTree
const esm = await import(pathToFileURL(join(dist, "esm", "index.js")).href)
const require = createRequire(import.meta.url)
const cjs = require(join(dist, "cjs", "index.js"))
if (typeof esm.PineTree !== "function" || typeof cjs.PineTree !== "function") {
  throw new Error("Generated SDK entry points do not export PineTree.")
}

// Consumer type-check: verify published type surface from a consumer perspective
const consumerPath = join(dist, "consumer-check.ts")
const consumerConfigPath = join(dist, "tsconfig.consumer.json")

writeFileSync(
  consumerPath,
  `import {
  PineTree,
  PineTreeBrowserError,
  CheckoutInitializationError,
  CheckoutSessionError,
  type CheckoutOptions,
  type CheckoutSessionResult,
  type CheckoutMode,
  type CheckoutEventName,
  type CheckoutEventPayload,
  type CheckoutEvent,
  type CheckoutEventHandler,
  type CheckoutOpenResult,
  type CheckoutError,
  type PineTreeJSOptions,
} from "@pinetreepayments/js"

const client = new PineTree("pk_live_typecheck")
const client2 = new PineTree({ publicKey: "pk_live_typecheck", baseUrl: "https://example.com" } satisfies PineTreeJSOptions)

declare const options: CheckoutOptions
declare const sessionResult: CheckoutSessionResult
declare const openResult: CheckoutOpenResult
declare const checkoutError: CheckoutError
declare const mode: CheckoutMode
declare const eventName: CheckoutEventName
declare const eventPayload: CheckoutEventPayload
declare const event: CheckoutEvent
declare const handler: CheckoutEventHandler

void [client, client2, options, sessionResult, openResult, checkoutError]
void [mode, eventName, eventPayload, event, handler]
void [PineTreeBrowserError, CheckoutInitializationError, CheckoutSessionError]
`
)

writeFileSync(
  consumerConfigPath,
  `${JSON.stringify(
    {
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "bundler",
        skipLibCheck: true,
        lib: ["dom", "dom.iterable", "es2020"],
      },
      files: ["consumer-check.ts"],
    },
    null,
    2
  )}\n`
)

execFileSync(process.execPath, [tsc, "-p", consumerConfigPath], {
  cwd: packageRoot,
  stdio: "inherit",
})

rmSync(consumerPath)
rmSync(consumerConfigPath)

console.log(`Built ${relative(process.cwd(), dist)} (ESM, CJS, and declarations).`)
