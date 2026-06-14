import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, extname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const dist = join(packageRoot, "dist")
const tsc = resolve(packageRoot, "..", "..", "node_modules", "typescript", "bin", "tsc")
const browserSdkRoot = resolve(packageRoot, "..", "pinetree-js")

rmSync(dist, { recursive: true, force: true })

// The React package consumes the browser SDK's generated public declarations.
execFileSync(process.execPath, [join(browserSdkRoot, "scripts", "build.mjs")], {
  cwd: browserSdkRoot,
  stdio: "inherit",
})

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
  writeFileSync(file, addJavaScriptExtensions(readFileSync(file, "utf8")))
}

for (const file of walk(join(dist, "types"))) {
  if (!file.endsWith(".d.ts")) continue
  writeFileSync(file, addJavaScriptExtensions(readFileSync(file, "utf8")))
}

for (const [directory, type] of [
  [join(dist, "esm"), "module"],
  [join(dist, "cjs"), "commonjs"],
]) {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, "package.json"), `${JSON.stringify({ type }, null, 2)}\n`)
}

const requiredOutputs = [
  "esm/index.js",
  "cjs/index.js",
  "types/index.d.ts",
  "types/components/PineTreeCheckout.d.ts",
  "types/components/PineTreeCheckoutButton.d.ts",
]
for (const output of requiredOutputs) {
  readFileSync(join(dist, output))
}

const consumerPath = join(dist, "consumer-check.tsx")
const consumerConfigPath = join(dist, "tsconfig.consumer.json")
writeFileSync(
  consumerPath,
  `import {
  PineTreeProvider,
  PineTreeCheckoutButton,
  PineTreeCheckout,
  usePineTree,
  type PineTreeProviderProps,
  type UsePineTreeResult,
  type PineTreeCheckoutButtonProps,
  type PineTreeCheckoutProps,
  type CheckoutEventPayload,
} from "@pinetreepayments/react"

declare const providerProps: PineTreeProviderProps
declare const buttonProps: PineTreeCheckoutButtonProps
declare const checkoutProps: PineTreeCheckoutProps
declare const client: UsePineTreeResult
declare const event: CheckoutEventPayload
void [PineTreeProvider, PineTreeCheckoutButton, PineTreeCheckout, usePineTree]
void [providerProps, buttonProps, checkoutProps, client, event]
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
        jsx: "react-jsx",
        skipLibCheck: true,
        lib: ["dom", "dom.iterable", "es2020"],
        paths: {
          "@pinetreepayments/react": ["./types/index.d.ts"],
          "@pinetreepayments/js": ["../pinetree-js/dist/types/index.d.ts"],
        },
      },
      files: ["consumer-check.tsx"],
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
