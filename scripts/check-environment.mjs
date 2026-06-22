#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const strict = process.argv.includes("--strict")

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const result = {}
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const index = trimmed.indexOf("=")
    if (index < 1) continue
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

const baseEnv = parseEnvFile(resolve(repoRoot, ".env"))
const localEnv = parseEnvFile(resolve(repoRoot, ".env.local"))
const env = { ...baseEnv, ...localEnv, ...process.env }

function sourceFor(name) {
  if (Object.prototype.hasOwnProperty.call(process.env, name)) return "process"
  if (Object.prototype.hasOwnProperty.call(localEnv, name)) return ".env.local"
  if (Object.prototype.hasOwnProperty.call(baseEnv, name)) return ".env"
  return "-"
}

function present(name) {
  return Boolean(String(env[name] ?? "").trim())
}

function validUrl(value, protocols = ["http:", "https:"]) {
  try {
    return protocols.includes(new URL(value).protocol)
  } catch {
    return false
  }
}

const groups = [
  {
    name: "Supabase",
    entries: [
      ["NEXT_PUBLIC_SUPABASE_URL", true, "url"],
      ["NEXT_PUBLIC_SUPABASE_ANON_KEY", true, "secret"],
      ["SUPABASE_SERVICE_ROLE_KEY", true, "secret"],
    ],
  },
  {
    name: "PineTree staging",
    entries: [
      ["NEXT_PUBLIC_APP_URL", true, "url"],
      ["CHECKOUT_SESSION_SECRET", true, "secret16"],
      ["TERMINAL_SESSION_SECRET", true, "secret16"],
      ["CRON_SECRET", true, "secret16"],
    ],
  },
  {
    name: "Shopify",
    entries: [
      ["SHOPIFY_CLIENT_ID", true, "text"],
      ["SHOPIFY_CLIENT_SECRET", true, "secret16"],
      ["SHOPIFY_SCOPES", true, "scopes"],
      ["SHOPIFY_APP_URL", true, "url"],
      ["SHOPIFY_TOKEN_ENCRYPTION_KEY", true, "hex64"],
    ],
  },
  {
    name: "WooCommerce install test",
    entries: [
      ["PINETREE_WOOCOMMERCE_BASE_URL", false, "url"],
      ["PINETREE_WOOCOMMERCE_API_KEY", false, "ptkey"],
      ["PINETREE_WOOCOMMERCE_WEBHOOK_SECRET", false, "webhook"],
    ],
  },
  {
    name: "SDK integration test",
    entries: [
      ["PINETREE_RUN_INTEGRATION", false, "boolean"],
      ["PINETREE_INTEGRATION_BASE_URL", false, "url"],
      ["PINETREE_INTEGRATION_API_KEY", false, "ptkey"],
      ["PINETREE_INTEGRATION_WEBHOOK_SECRET", false, "webhook"],
      ["PINETREE_INTEGRATION_PAYMENT_ID", false, "text"],
    ],
  },
  {
    name: "Stripe card processing",
    entries: [
      ["STRIPE_SECRET_KEY", false, "secret16"],
      ["STRIPE_WEBHOOK_SECRET", false, "secret16"],
      ["STRIPE_API_VERSION", false, "text"],
      ["STRIPE_APPLICATION_URL", false, "url"],
    ],
  },
  {
    name: "Provider webhook signing",
    entries: [
      ["SPEED_WEBHOOK_SECRET", true, "secret16"],
      ["ALCHEMY_WEBHOOK_SIGNING_KEY_SOLANA", false, "secret16"],
      ["ALCHEMY_WEBHOOK_SIGNING_KEY_BASE", false, "secret16"],
      ["ALCHEMY_WEBHOOK_SIGNING_KEY", false, "secret16"],
      ["SHIFT4_WEBHOOK_SHARED_SECRET", false, "secret16"],
      ["COINBASE_WEBHOOK_SHARED_SECRET", false, "secret16"],
      ["MOONPAY_WEBHOOK_SECRET", false, "secret16"],
    ],
  },
]

function validation(name, kind) {
  const value = String(env[name] ?? "").trim()
  if (!value) return { ok: false, detail: "missing" }
  if (kind === "url") return validUrl(value) ? { ok: true } : { ok: false, detail: "invalid URL" }
  if (kind === "secret16") return value.length >= 16
    ? { ok: true }
    : { ok: false, detail: "must be at least 16 characters" }
  if (kind === "hex64") return /^[a-f0-9]{64}$/i.test(value)
    ? { ok: true }
    : { ok: false, detail: "must be 64 hexadecimal characters" }
  if (kind === "ptkey") return /^pt_(live|test)_[A-Za-z0-9_-]+$/.test(value)
    ? { ok: true }
    : { ok: false, detail: "expected pt_live_* or pt_test_*" }
  if (kind === "webhook") return value.length >= 16
    ? { ok: true }
    : { ok: false, detail: "too short" }
  if (kind === "boolean") return ["true", "false", "1", "0"].includes(value.toLowerCase())
    ? { ok: true }
    : { ok: false, detail: "expected true/false or 1/0" }
  if (kind === "scopes") {
    const required = ["read_orders", "write_orders", "read_checkouts"]
    const scopes = new Set(value.split(",").map((item) => item.trim()).filter(Boolean))
    const missing = required.filter((scope) => !scopes.has(scope))
    return missing.length === 0
      ? { ok: true }
      : { ok: false, detail: `missing scopes: ${missing.join(", ")}` }
  }
  return { ok: true }
}

let requiredFailures = 0
const warnings = []

console.log(`PineTree environment check${strict ? " (strict)" : ""}`)
console.log("Values are never printed.\n")

for (const group of groups) {
  console.log(group.name)
  for (const [name, required, kind] of group.entries) {
    const result = validation(name, kind)
    const state = result.ok ? "present" : result.detail
    console.log(`  ${result.ok ? "OK" : required ? "MISSING" : "optional"}  ${name} (${state}; source: ${sourceFor(name)})`)
    if (required && !result.ok) requiredFailures += 1
  }
  console.log("")
}

const nodeEnv = String(env.NODE_ENV ?? "development").toLowerCase()
for (const name of ["NEXT_PUBLIC_APP_URL", "SHOPIFY_APP_URL", "PINETREE_INTEGRATION_BASE_URL"]) {
  const value = String(env[name] ?? "").trim()
  if (!value || !validUrl(value)) continue
  const host = new URL(value).hostname.toLowerCase()
  const localMode = nodeEnv !== "production"
  const productionLooking = host === "app.pinetree-payments.com" || (!host.includes("localhost") && host !== "127.0.0.1" && !host.includes("staging"))
  if (localMode && productionLooking) {
    warnings.push(`${name} looks production-like while NODE_ENV is ${nodeEnv}.`)
  }
}

if (present("PINETREE_INTEGRATION_API_KEY")) {
  const base = String(env.PINETREE_INTEGRATION_BASE_URL ?? "")
  if (/^pt_live_/i.test(String(env.PINETREE_INTEGRATION_API_KEY)) && /localhost|127\.0\.0\.1/i.test(base)) {
    warnings.push("A pt_live_* integration key targets a local URL. Confirm it belongs only to the local database.")
  }
}

console.log("Derived Shopify URLs")
if (present("SHOPIFY_APP_URL") && validUrl(String(env.SHOPIFY_APP_URL))) {
  const base = String(env.SHOPIFY_APP_URL).replace(/\/$/, "")
  console.log(`  callback: ${base}/api/shopify/auth/callback`)
  console.log(`  webhook:  ${base}/api/shopify/webhooks`)
} else {
  console.log("  unavailable until SHOPIFY_APP_URL is valid")
}

if (warnings.length > 0) {
  console.log("\nWarnings")
  for (const warning of warnings) console.log(`  WARN  ${warning}`)
}

console.log(`\nRequired issues: ${requiredFailures}`)
if (strict && requiredFailures > 0) process.exit(1)
