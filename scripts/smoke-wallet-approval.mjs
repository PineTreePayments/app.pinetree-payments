#!/usr/bin/env node
/**
 * PineTree Wallet Approval Smoke Test
 *
 * API-level smoke test for the merchant wallet send-session / approval flow.
 * Does NOT require real wallet hardware — tests the session lifecycle,
 * middleware bypass, and validation logic.
 *
 * Required env vars:
 *   WALLET_APPROVAL_SMOKE_TEST=1         — required safety gate
 *   NEXT_PUBLIC_APP_URL                  — e.g. http://localhost:3000
 *   SUPABASE_SERVICE_ROLE_KEY            — for creating test sessions directly
 *   NEXT_PUBLIC_SUPABASE_URL             — Supabase project URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY        — Supabase anon key
 *
 * Run:
 *   npm run smoke:wallet-approval
 *   # or with env inline:
 *   WALLET_APPROVAL_SMOKE_TEST=1 NEXT_PUBLIC_APP_URL=http://localhost:3000 \
 *     SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... \
 *     NEXT_PUBLIC_SUPABASE_ANON_KEY=... node scripts/smoke-wallet-approval.mjs
 */

import { createClient } from "@supabase/supabase-js"

// ── Safety gate ──────────────────────────────────────────────────────────────

if (process.env.WALLET_APPROVAL_SMOKE_TEST !== "1") {
  console.error("Set WALLET_APPROVAL_SMOKE_TEST=1 to run this smoke test.")
  process.exit(1)
}

const BASE_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "")
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error("Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY")
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY)

// ── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const failures = []

function ok(label) {
  console.log(`  \x1b[32m✓\x1b[0m ${label}`)
  passed++
}

function fail(label, detail) {
  console.log(`  \x1b[31m✗\x1b[0m ${label}`)
  if (detail) console.log(`      ${detail}`)
  failed++
  failures.push({ label, detail })
}

async function get(path) {
  const r = await fetch(`${BASE_URL}${path}`, { headers: { "Cache-Control": "no-store" } })
  return { status: r.status, body: await r.json().catch(() => null) }
}

async function post(path, body) {
  const r = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

async function patch(path, body) {
  const r = await fetch(`${BASE_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

async function createTestSession(overrides = {}) {
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  const row = {
    merchant_id:         "smoke-test-merchant",
    wallet_id:           "smoke-test-wallet",
    rail:                "base",
    wallet_type:         "base",
    wallet_address:      "0xSMOKETEST0000000000000000000000000000001",
    asset:               "USDC",
    network:             "base",
    destination_address: "0xSMOKETEST0000000000000000000000000000002",
    destination_label:   "Smoke Test Destination",
    amount:              "1.00",
    prepared_payload:    {
      tx_params: {
        from:  "0xSMOKETEST0000000000000000000000000000001",
        to:    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        value: "0x0",
        data:  "0xa9059cbb0000000000000000000000smokeTEST000000000000000000000000000000000000000000000000000000000000000000000000000000000f4240",
        gas:   "0x186A0",
      },
      destination_kind: "manual_address",
    },
    status:              "created",
    tx_hash:             null,
    signature:           null,
    error:               null,
    expires_at:          expiresAt,
    updated_at:          now,
    ...overrides,
  }

  const { data, error } = await db
    .from("merchant_wallet_send_sessions")
    .insert(row)
    .select("*")
    .single()

  if (error) throw new Error(`DB insert failed: ${error.message}`)
  return data
}

async function createPhantomTestSession() {
  return createTestSession({
    rail:        "solana",
    wallet_type: "phantom",
    wallet_address: "PHANTOMtestPUBLICKEYxxxxxxxxxxxxxxxxxxx",
    asset:       "USDC",
    network:     "solana",
    destination_address: "SOLANAtestDESTxxxxxxxxxxxxxxxxxxxxxxxxxx",
    prepared_payload: {
      unsigned_tx_base64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      destination_kind:   "manual_address",
    },
  })
}

async function deleteSession(id) {
  await db.from("merchant_wallet_send_sessions").delete().eq("id", id)
}

// ── Tests ────────────────────────────────────────────────────────────────────

async function run() {
  console.log("\n\x1b[1mPineTree Wallet Approval Smoke Test\x1b[0m")
  console.log(`Target: ${BASE_URL}\n`)

  const sessionIds = []

  // ── Test 1: POST /api/wallets/send-sessions without auth is unauthorized ────
  console.log("1. Auth guard on session creation")
  {
    const { status } = await post("/api/wallets/send-sessions", { wallet_id: "x", rail: "base" })
    if (status === 401) ok("POST /api/wallets/send-sessions without auth returns 401")
    else fail("POST /api/wallets/send-sessions without auth returns 401", `got ${status}`)
  }

  // ── Test 2: GET non-existent session returns 404 ─────────────────────────
  console.log("\n2. Non-existent session")
  {
    const { status, body } = await get("/api/wallets/send-sessions/00000000-0000-0000-0000-000000000000")
    if (status === 404) ok("GET unknown session returns 404")
    else fail("GET unknown session returns 404", `got ${status} — ${body?.error}`)
  }

  // ── Test 3: Create Base Wallet test session ───────────────────────────────
  console.log("\n3. Base Wallet session lifecycle")
  let baseSession
  try {
    baseSession = await createTestSession()
    sessionIds.push(baseSession.id)
    ok(`Created Base Wallet test session (${baseSession.id})`)
  } catch (err) {
    fail("Create Base Wallet test session", err.message)
    baseSession = null
  }

  if (baseSession) {
    // Test 4: GET session works without auth
    const { status, body } = await get(`/api/wallets/send-sessions/${baseSession.id}`)
    if (status === 200 && body?.success && body?.session?.id === baseSession.id) {
      ok("GET send session works without auth (middleware bypass)")
    } else {
      fail("GET send session works without auth", `status=${status} success=${body?.success}`)
    }

    // Test 5: wallet_type is "base" — should NOT show metamask or trust
    const s = body?.session
    if (s?.wallet_type === "base") ok("Session wallet_type is base")
    else fail("Session wallet_type is base", `got ${s?.wallet_type}`)

    if (s?.wallet_type !== "metamask" && s?.wallet_type !== "trust") {
      ok("Session does not identify as metamask or trust")
    } else {
      fail("Session does not identify as metamask or trust", `got ${s?.wallet_type}`)
    }

    // Test 6: PATCH status update works without auth
    const { status: ps } = await patch(`/api/wallets/send-sessions/${baseSession.id}`, { status: "opened" })
    if (ps === 200) ok("PATCH session status (opened) works without auth")
    else fail("PATCH session status (opened) works without auth", `got ${ps}`)

    // Test 7: Complete endpoint rejects missing tx_hash
    const { status: cs, body: cb } = await post(`/api/wallets/send-sessions/${baseSession.id}/complete`, {})
    if (cs === 400 && cb?.error) ok(`Complete endpoint rejects missing tx_hash (${cb.error})`)
    else fail("Complete endpoint rejects missing tx_hash", `got ${cs} — ${cb?.error}`)

    // Test 8: Complete endpoint rejects malformed tx_hash
    const { status: cs2, body: cb2 } = await post(`/api/wallets/send-sessions/${baseSession.id}/complete`, { tx_hash: "not-a-hash" })
    if (cs2 === 400) ok(`Complete endpoint rejects invalid tx_hash format (${cb2?.error})`)
    else fail("Complete endpoint rejects invalid tx_hash format", `got ${cs2} — ${cb2?.error}`)
  }

  // ── Test 9: Phantom session ─────────────────────────────────────────────
  console.log("\n4. Phantom (Solana) session lifecycle")
  let phantomSession
  try {
    phantomSession = await createPhantomTestSession()
    sessionIds.push(phantomSession.id)
    ok(`Created Phantom test session (${phantomSession.id})`)
  } catch (err) {
    fail("Create Phantom test session", err.message)
    phantomSession = null
  }

  if (phantomSession) {
    const { status, body } = await get(`/api/wallets/send-sessions/${phantomSession.id}`)
    if (status === 200 && body?.session?.wallet_type === "phantom") {
      ok("GET Phantom session — wallet_type is phantom")
    } else {
      fail("GET Phantom session — wallet_type is phantom", `got ${body?.session?.wallet_type}`)
    }

    // Test: Session does NOT identify as base or metamask
    if (body?.session?.wallet_type !== "base" && body?.session?.wallet_type !== "metamask") {
      ok("Phantom session does not identify as base or metamask")
    } else {
      fail("Phantom session does not identify as base or metamask", `got ${body?.session?.wallet_type}`)
    }

    // Test: Complete endpoint rejects missing signature for Solana
    const { status: cs, body: cb } = await post(`/api/wallets/send-sessions/${phantomSession.id}/complete`, {})
    if (cs === 400 && cb?.error?.toLowerCase().includes("signature")) {
      ok(`Solana complete endpoint requires signature (${cb.error})`)
    } else {
      fail("Solana complete endpoint requires signature", `got ${cs} — ${cb?.error}`)
    }

    // Test: Complete endpoint rejects too-short signature
    const { status: cs2, body: cb2 } = await post(`/api/wallets/send-sessions/${phantomSession.id}/complete`, { signature: "tooshort" })
    if (cs2 === 400) ok(`Solana complete endpoint rejects short signature (${cb2?.error})`)
    else fail("Solana complete endpoint rejects short signature", `got ${cs2} — ${cb2?.error}`)

    // Test: refresh-tx rejects non-Solana session (if baseSession exists)
    if (baseSession) {
      const { status: rs } = await post(`/api/wallets/send-sessions/${baseSession.id}/refresh-tx`, {})
      if (rs === 400) ok("refresh-tx rejects Base (non-Solana) session")
      else fail("refresh-tx rejects Base (non-Solana) session", `got ${rs}`)
    }

    // Test: refresh-tx endpoint is publicly accessible (no 401)
    const { status: rs2, body: rb2 } = await post(`/api/wallets/send-sessions/${phantomSession.id}/refresh-tx`, {})
    if (rs2 !== 401) {
      ok(`refresh-tx endpoint is publicly accessible (status ${rs2})`)
    } else {
      fail("refresh-tx endpoint is publicly accessible", "returned 401 — middleware bypass missing")
    }
    // Note: it may return 500 if Solana RPC is unavailable in this env
    if (rb2?.error) {
      console.log(`      (refresh-tx response: ${rb2.error})`)
    }
  }

  // ── Test: Expired session ───────────────────────────────────────────────
  console.log("\n5. Expired session handling")
  let expiredSession
  try {
    expiredSession = await createTestSession({
      status:     "expired",
      expires_at: new Date(Date.now() - 1000).toISOString(),
    })
    sessionIds.push(expiredSession.id)

    const { status } = await get(`/api/wallets/send-sessions/${expiredSession.id}`)
    // Status is already "expired", not in (created|opened), so GET returns 200 (not 410)
    // Complete should reject it:
    const { status: cs } = await post(`/api/wallets/send-sessions/${expiredSession.id}/complete`, {
      tx_hash: "0x" + "a".repeat(64)
    })
    if (cs === 400) ok("Complete endpoint rejects already-expired session")
    else fail("Complete endpoint rejects already-expired session", `got ${cs}`)
  } catch (err) {
    fail("Expired session test", err.message)
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────
  console.log("\n6. Cleanup")
  for (const id of sessionIds) {
    try {
      await deleteSession(id)
      ok(`Deleted test session ${id}`)
    } catch (err) {
      fail(`Delete test session ${id}`, err.message)
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`)
  console.log(`Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`)
  if (failures.length > 0) {
    console.log("\nFailures:")
    for (const { label, detail } of failures) {
      console.log(`  - ${label}${detail ? ` (${detail})` : ""}`)
    }
  }
  console.log()

  console.log("Manual steps that cannot be automated:")
  console.log("  Phantom:")
  console.log("    1. Desktop: create send → scan QR")
  console.log("    2. Mobile: tap 'Approve with Phantom'")
  console.log("    3. Phantom: approve PineTree connection")
  console.log("    4. Mobile: tap 'Approve Transaction in Phantom'")
  console.log("    5. Phantom: approve transaction")
  console.log("    6. Desktop: status changes to Submitted")
  console.log("    7. Activity row appears in Send history")
  console.log("  Base Wallet:")
  console.log("    1. Desktop: create send → scan QR")
  console.log("    2. Mobile: tap 'Approve with Base Wallet'")
  console.log("    3. Base Wallet in-app browser opens approval page")
  console.log("    4. eth_requestAccounts prompt shown")
  console.log("    5. eth_sendTransaction prompt shown")
  console.log("    6. Approve → tx hash returned")
  console.log("    7. Desktop: status changes to Submitted")
  console.log("    8. Activity row appears in Send history")
  console.log("  Wrong wallet test:")
  console.log("    1. Scan QR for Phantom session with a different Phantom account")
  console.log("    2. Approval page should show 'Connected wallet does not match'")
  console.log()

  if (failed > 0) process.exit(1)
}

run().catch((err) => {
  console.error("Smoke test crashed:", err)
  process.exit(1)
})
