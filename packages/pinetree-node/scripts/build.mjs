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

const esm = await import(pathToFileURL(join(dist, "esm", "index.js")).href)
const require = createRequire(import.meta.url)
const cjs = require(join(dist, "cjs", "index.js"))
if (typeof esm.PineTree !== "function" || typeof cjs.PineTree !== "function") {
  throw new Error("Generated SDK entry points do not export PineTree.")
}

const consumerPath = join(dist, "consumer-check.ts")
const consumerConfigPath = join(dist, "tsconfig.consumer.json")
writeFileSync(
  consumerPath,
  `import {
  PineTree,
  PineTreeError,
  AuthenticationError,
  PermissionError,
  InvalidRequestError,
  APIConnectionError,
  IdempotencyConflictError,
  WebhookVerificationError,
  type CheckoutSession,
  type CheckoutSessionList,
  type Payment,
  type WebhookDelivery,
  type Event,
} from "@pinetreepayments/node"

const client = new PineTree("pt_live_typecheck")
declare const session: CheckoutSession
declare const sessions: CheckoutSessionList
declare const payment: Payment
declare const delivery: WebhookDelivery
declare const event: Event
void [client, session, sessions, payment, delivery, event]
void [
  PineTreeError,
  AuthenticationError,
  PermissionError,
  InvalidRequestError,
  APIConnectionError,
  IdempotencyConflictError,
  WebhookVerificationError,
]
`
)
writeFileSync(
  consumerConfigPath,
  `${JSON.stringify(
    {
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        skipLibCheck: true,
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
