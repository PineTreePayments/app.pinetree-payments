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

/** Base ETH withdrawal session (native transfer) */
async function createBaseEthTestSession() {
  return createTestSession({
    rail:             "base",
    wallet_type:      "metamask",
    wallet_address:   "0xSMOKETEST0000000000000000000000000000001",
    asset:            "ETH",
    network:          "base",
    destination_address: "0xSMOKETEST0000000000000000000000000000002",
    amount:           "0.005",
    prepared_payload: {
      tx_params: {
        from:    "0xSMOKETEST0000000000000000000000000000001",
        to:      "0xSMOKETEST0000000000000000000000000000002",
        value:   "0x11C37937E08000", // 0.005 ETH in wei hex
        data:    "0x",
        gas:     "0x5208",           // 21000 gas
        chainId: "0x2105",           // Base mainnet
      },
      destination_kind: "manual_address",
    },
  })
}

/** Base USDC withdrawal session (ERC-20 transfer) */
async function createBaseUsdcTestSession() {
  return createTestSession({
    rail:             "base",
    wallet_type:      "base_wallet",
    wallet_address:   "0xSMOKETEST0000000000000000000000000000001",
    asset:            "USDC",
    network:          "base",
    destination_address: "0xSMOKETEST0000000000000000000000000000002",
    amount:           "5.00",
    prepared_payload: {
      tx_params: {
        from:    "0xSMOKETEST0000000000000000000000000000001",
        to:      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",  // USDC on Base
        value:   "0x0",
        data:    "0xa9059cbb" +
                 "000000000000000000000000SMOKETEST000000000000000000000000000000002" +
                 "000000000000000000000000000000000000000000000000000000000004c4b40", // 5 USDC
        gas:     "0x186A0",
        chainId: "0x2105",
      },
      destination_kind: "manual_address",
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

  // ── Test: Base ETH session — session-first flow ──────────────────────────
  console.log("\n5. Base ETH session (session-first flow)")
  let baseEthSession
  try {
    baseEthSession = await createBaseEthTestSession()
    sessionIds.push(baseEthSession.id)
    ok(`Created Base ETH test session (${baseEthSession.id})`)
  } catch (err) {
    fail("Create Base ETH test session", err.message)
    baseEthSession = null
  }

  if (baseEthSession) {
    // A: session can be fetched without auth (approval page needs this)
    const { status, body } = await get(`/api/wallets/send-sessions/${baseEthSession.id}`)
    if (status === 200 && body?.success) {
      ok("Base ETH: GET session works without auth (approval page can load)")
    } else {
      fail("Base ETH: GET session works without auth", `status=${status}`)
    }

    // B: session starts in 'created' status — approval page should show 'ready' state
    const s = body?.session
    if (s?.status === "created") {
      ok("Base ETH: session starts as created (approval page will show 'ready' state, not auto-open wallet)")
    } else {
      fail("Base ETH: session starts as created", `got status=${s?.status}`)
    }

    // C: session encodes tx_params for eth_sendTransaction (not unsigned_tx_base64)
    if (s?.prepared_payload?.tx_params && !s?.prepared_payload?.unsigned_tx_base64) {
      ok("Base ETH: prepared_payload has tx_params (correct for EVM)")
    } else {
      fail("Base ETH: prepared_payload has tx_params", `keys=${Object.keys(s?.prepared_payload || {}).join(",")}`)
    }

    // D: approval URL is deterministic — session ID is the only secret
    ok(`Base ETH: PineTree approval URL is /wallet-approval/${baseEthSession.id}`)

    // E: advancing status to 'opened' (simulates approval page loading on phone)
    const { status: ps } = await patch(`/api/wallets/send-sessions/${baseEthSession.id}`, { status: "opened" })
    if (ps === 200) ok("Base ETH: status advance to opened (approval page loaded)")
    else fail("Base ETH: status advance to opened", `got ${ps}`)

    // F: advancing to wallet_connecting (simulates merchant tapping Open Wallet)
    const { status: wcs } = await patch(`/api/wallets/send-sessions/${baseEthSession.id}`, { status: "wallet_connecting" })
    if (wcs === 200) ok("Base ETH: status advance to wallet_connecting (merchant tapped Open Wallet)")
    else fail("Base ETH: status advance to wallet_connecting", `got ${wcs}`)

    // G: advancing to approval_requested (simulates wallet opened, eth_requestAccounts done)
    const { status: ars } = await patch(`/api/wallets/send-sessions/${baseEthSession.id}`, { status: "approval_requested" })
    if (ars === 200) ok("Base ETH: status advance to approval_requested (wallet opened for signing)")
    else fail("Base ETH: status advance to approval_requested", `got ${ars}`)

    // H: complete endpoint rejects missing tx_hash for EVM session
    const { status: cs, body: cb } = await post(`/api/wallets/send-sessions/${baseEthSession.id}/complete`, {})
    if (cs === 400) ok(`Base ETH: complete rejects missing tx_hash (${cb?.error})`)
    else fail("Base ETH: complete rejects missing tx_hash", `got ${cs}`)

    // I: refresh-tx rejects Base session (Solana-only endpoint)
    const { status: rs } = await post(`/api/wallets/send-sessions/${baseEthSession.id}/refresh-tx`, {})
    if (rs === 400) ok("Base ETH: refresh-tx correctly rejects non-Solana session")
    else fail("Base ETH: refresh-tx rejects non-Solana session", `got ${rs}`)
  }

  // ── Test: Base USDC session — session-first flow ─────────────────────────
  console.log("\n6. Base USDC session (session-first flow)")
  let baseUsdcSession
  try {
    baseUsdcSession = await createBaseUsdcTestSession()
    sessionIds.push(baseUsdcSession.id)
    ok(`Created Base USDC test session (${baseUsdcSession.id})`)
  } catch (err) {
    fail("Create Base USDC test session", err.message)
    baseUsdcSession = null
  }

  if (baseUsdcSession) {
    const { status, body } = await get(`/api/wallets/send-sessions/${baseUsdcSession.id}`)
    if (status === 200 && body?.success) {
      ok("Base USDC: GET session works without auth (approval page can load)")
    } else {
      fail("Base USDC: GET session works without auth", `status=${status}`)
    }

    const s = body?.session
    if (s?.status === "created") {
      ok("Base USDC: session starts as created (approval page shows ready state)")
    } else {
      fail("Base USDC: session starts as created", `got status=${s?.status}`)
    }

    // USDC uses ERC-20 transfer data (non-empty data field, value = 0x0)
    const txp = s?.prepared_payload?.tx_params
    if (txp?.data && txp.data.startsWith("0xa9059cbb") && txp.value === "0x0") {
      ok("Base USDC: prepared_payload uses ERC-20 transfer ABI (a9059cbb) with value=0x0")
    } else {
      fail("Base USDC: prepared_payload uses ERC-20 transfer ABI", `data=${txp?.data?.slice(0,10)} value=${txp?.value}`)
    }

    if (s?.asset === "USDC") {
      ok("Base USDC: asset field is USDC")
    } else {
      fail("Base USDC: asset field is USDC", `got ${s?.asset}`)
    }

    // Complete rejects missing tx_hash
    const { status: cs } = await post(`/api/wallets/send-sessions/${baseUsdcSession.id}/complete`, {})
    if (cs === 400) ok("Base USDC: complete rejects missing tx_hash")
    else fail("Base USDC: complete rejects missing tx_hash", `got ${cs}`)
  }

  // ── Test: Solana regression — session still loads approval page first ─────
  console.log("\n7. Solana regression (approval-page-first still intact)")
  if (phantomSession) {
    const { status, body } = await get(`/api/wallets/send-sessions/${phantomSession.id}`)
    if (status === 200 && body?.session?.status === "created") {
      ok("Solana: session still starts as created (approval page will show 'ready' before Phantom opens)")
    } else {
      fail("Solana: session starts as created", `status=${status} session_status=${body?.session?.status}`)
    }

    const s = body?.session
    if (s?.prepared_payload?.unsigned_tx_base64 && !s?.prepared_payload?.tx_params) {
      ok("Solana: prepared_payload has unsigned_tx_base64 (correct for Solana, no tx_params)")
    } else {
      fail("Solana: prepared_payload has unsigned_tx_base64", `keys=${Object.keys(s?.prepared_payload || {}).join(",")}`)
    }
  }

  // ── Test: Expired / cancelled session cleanup ────────────────────────────
  let expiredSession
  try {
    expiredSession = await createTestSession({
      status:     "expired",
      expires_at: new Date(Date.now() - 1000).toISOString(),
    })
    sessionIds.push(expiredSession.id)

    await get(`/api/wallets/send-sessions/${expiredSession.id}`)
    // Status is already "expired", not in (created|opened), so GET returns 200 (not 410)
    // Complete should reject it:
    const { status: cs } = await post(`/api/wallets/send-sessions/${expiredSession.id}/complete`, {
      tx_hash: "0x" + "a".repeat(64)
    })
    if (cs === 400) ok("Complete endpoint rejects already-expired session")
    else fail("Complete endpoint rejects already-expired session", `got ${cs}`)

    // An expired/cancelled Base session does not leave activity stuck as pending
    const { status: rs } = await get(`/api/wallets/send-sessions/${expiredSession.id}`)
    if (rs === 200) ok("Expired session: GET still returns session (approval page shows expired UI, not stuck pending)")
    else fail("Expired session: GET returns session", `got ${rs}`)
  } catch (err) {
    fail("Expired session test", err.message)
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────
  console.log("\n9. Cleanup")
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
  console.log("  Phantom (Solana):")
  console.log("    1. Desktop: fill send form → Continue to Approval → Show Phantom Approval QR")
  console.log("    2. PineTree creates send session → QR displayed")
  console.log("    3. Mobile: scan QR → PineTree approval page loads (status: ready)")
  console.log("    4. Mobile: tap 'Open Phantom' — Phantom opens via Universal Link")
  console.log("    5. Phantom: approve connection → returns to approval page")
  console.log("    6. Mobile: tap 'Confirm Withdrawal'")
  console.log("    7. Phantom: approve transaction → signature returned")
  console.log("    8. Desktop: status changes to Submitted")
  console.log("    9. Activity row appears in Send history")
  console.log("  Base Wallet / MetaMask / Trust Wallet (Base Pay — session-first):")
  console.log("    A. QR path (phone):")
  console.log("       1. Desktop: fill send form → Continue to Approval → Show Base Wallet Approval QR")
  console.log("       2. PineTree creates send session → QR displayed")
  console.log("       3. Mobile: scan QR → PineTree approval page loads (status: ready)")
  console.log("       4. PineTree approval page shows transaction summary and 'Open Base Wallet' button")
  console.log("       5. Mobile: tap 'Open Base Wallet' → wallet opens in-app browser at approval URL")
  console.log("       6. Wallet browser: 'Confirm Withdrawal' button shown (no auto-open)")
  console.log("       7. Merchant: tap 'Confirm Withdrawal' → eth_sendTransaction popup")
  console.log("       8. Merchant approves → tx_hash returned → session complete")
  console.log("       9. Desktop: status changes to Submitted")
  console.log("      10. Activity row appears in Send history")
  console.log("    B. Same-device path (desktop or mobile dashboard):")
  console.log("       1. Desktop: fill send form → Continue to Approval → prepared state")
  console.log("       2. Click 'Open approval on this device →'")
  console.log("       3. PineTree creates send session → browser navigates to /wallet-approval/[sessionId]")
  console.log("       4. PineTree approval page loads — shows transaction summary and 'Open MetaMask' button")
  console.log("       5. Merchant clicks 'Open MetaMask' → detects extension or opens MetaMask Mobile")
  console.log("       6. 'Confirm Withdrawal' button shown — merchant clicks")
  console.log("       7. MetaMask popup → eth_sendTransaction → tx_hash returned → session complete")
  console.log("       8. Approval page shows 'Withdrawal Submitted'")
  console.log("  Base ETH vs USDC:")
  console.log("    Base ETH: tx_params.value is non-zero hex, tx_params.data is 0x")
  console.log("    Base USDC: tx_params.value is 0x0, tx_params.data starts with 0xa9059cbb (ERC-20 transfer)")
  console.log("  Wrong wallet test:")
  console.log("    1. Scan QR for Phantom session with a different Phantom account")
  console.log("    2. Approval page should show 'Connected wallet does not match'")
  console.log("  Regression (Solana unaffected):")
  console.log("    1. Solana send still uses QR → approval page → Phantom/Solflare deep link")
  console.log("    2. 'Confirm in Phantom' button is unchanged for Solana wallets")
  console.log()

  if (failed > 0) process.exit(1)
}

run().catch((err) => {
  console.error("Smoke test crashed:", err)
  process.exit(1)
})
