#!/usr/bin/env node
/**
 * Local Integration Credential Setup
 *
 * Creates a pt_live_* API key in the local database for SDK integration testing
 * and outputs the PINETREE_INTEGRATION_* environment variables needed to run
 * the test suite.
 *
 * PineTree uses a single key format — pt_live_<64-hex> — for all environments.
 * Keys created here are local integration keys that only exist in your local
 * Supabase instance. Do not use production pt_live_* keys against a local server.
 *
 * Prerequisites:
 *   - Local dev server running (npm run dev)
 *   - .env.local present at the repository root with NEXT_PUBLIC_SUPABASE_URL
 *     and SUPABASE_SERVICE_ROLE_KEY
 *   - A valid merchant UUID to associate the key with
 *
 * Usage (from repo root):
 *   node packages/pinetree-node/scripts/setup-integration.mjs --merchant-id <uuid>
 *   node packages/pinetree-node/scripts/setup-integration.mjs --merchant-id <uuid> --name "SDK local integration"
 *
 * Output:
 *   Prints the PINETREE_INTEGRATION_* variables to set before running tests.
 */

import { readFileSync, existsSync } from "node:fs"
import { createHmac, randomBytes, createHash } from "node:crypto"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..", "..", "..")
const require = createRequire(import.meta.url)

// ── Parse arguments ──────────────────────────────────────────────────────────
const args = process.argv.slice(2)
function getArg(flag) {
  const i = args.indexOf(flag)
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null
}

const merchantId = getArg("--merchant-id")
const keyName = getArg("--name") ?? "SDK local integration"

if (!merchantId) {
  console.error("Usage: node scripts/setup-integration.mjs --merchant-id <uuid> [--name <name>]")
  process.exit(1)
}

// Basic UUID format check
if (!/^[0-9a-f-]{36}$/i.test(merchantId)) {
  console.error("--merchant-id must be a valid UUID (e.g. 550e8400-e29b-41d4-a716-446655440000)")
  process.exit(1)
}

// ── Load .env.local ───────────────────────────────────────────────────────────
function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const env = {}
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

const envLocal = parseEnvFile(resolve(repoRoot, ".env.local"))
const envBase = parseEnvFile(resolve(repoRoot, ".env"))
const env = { ...envBase, ...envLocal, ...process.env }

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.\n" +
    "Make sure the local environment is configured before running this script."
  )
  process.exit(1)
}

// ── Generate pt_live_* local integration key ──────────────────────────────────
// PineTree uses one key format for all environments: pt_live_<64-hex>.
// This key is created in the LOCAL database only — it is not a production key.
const PREFIX_SUFFIX_LENGTH = 12

const rawHex = randomBytes(32).toString("hex") // 64 hex chars
const plaintext = `pt_live_${rawHex}`
const prefix = `pt_live_${rawHex.slice(0, PREFIX_SUFFIX_LENGTH)}`
const keyHash = createHash("sha256").update(plaintext).digest("hex")
const keyId = crypto.randomUUID()

// ── Generate a webhook test secret (any strong random string) ─────────────────
const webhookSecret = `whsec_${randomBytes(32).toString("hex")}`

// ── Insert key via Supabase REST API ─────────────────────────────────────────
const insertUrl = `${supabaseUrl}/rest/v1/merchant_api_keys`
const permissions = [
  "checkout.sessions:create",
  "checkout.sessions:read",
  "checkout.sessions:write",
  "payments:read",
  "checkout.links:create",
  "webhooks:read",
  "webhooks:write",
]

const body = JSON.stringify([{
  id: keyId,
  merchant_id: merchantId,
  name: keyName,
  key_prefix: prefix,
  key_hash: keyHash,
  permissions,
}])

const response = await fetch(insertUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "apikey": serviceRoleKey,
    "Authorization": `Bearer ${serviceRoleKey}`,
    "Prefer": "return=representation",
  },
  body,
})

if (!response.ok) {
  const text = await response.text()
  console.error(`Failed to create API key (HTTP ${response.status}):\n${text}`)
  process.exit(1)
}

const [created] = await response.json()

// ── Output env vars ───────────────────────────────────────────────────────────
console.log(`
Local integration key created.
Key name:  ${keyName}
Key ID:    ${created.id}
Merchant:  ${merchantId}

This is a LOCAL INTEGRATION KEY — it exists only in your local database.
Do not use a production pt_live_* key against a local server.

Set these environment variables before running integration tests:

  PINETREE_RUN_INTEGRATION=true
  PINETREE_INTEGRATION_BASE_URL=http://localhost:3000
  PINETREE_INTEGRATION_API_KEY=${plaintext}
  PINETREE_INTEGRATION_WEBHOOK_SECRET=${webhookSecret}

PowerShell:
  $env:PINETREE_RUN_INTEGRATION = "true"
  $env:PINETREE_INTEGRATION_BASE_URL = "http://localhost:3000"
  $env:PINETREE_INTEGRATION_API_KEY = "${plaintext}"
  $env:PINETREE_INTEGRATION_WEBHOOK_SECRET = "${webhookSecret}"

Then run:
  npm run test:integration:local --workspace packages/pinetree-node

Note: The webhook secret above is a standalone signing secret for local fixture
tests — it does not need to match a registered webhook endpoint.

WARNING: Store this key value securely. It will not be shown again.
`)
