import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"
import { decideDynamicUserIdWrite, isLegacyOrInvalidDynamicUserId } from "@/lib/wallets/dynamicIdentityRepair"
import { findDynamicApprovalWalletForSource } from "@/lib/wallets/dynamicSignerLookup"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

const profileRoute = read("app/api/wallets/pinetree-profile/route.ts")

const MERCHANT_ID = "18215ad9-c587-4be5-baf4-6bef03cb81fc"
const REAL_DYNAMIC_USER_ID = "dynamic-user-509436"
const OTHER_VALID_DYNAMIC_USER_ID = "dynamic-user-different-owner"

describe("Dynamic identity write/repair contract", () => {
  it("1. merchant_id is never accepted as dynamic_user_id", () => {
    const decision = decideDynamicUserIdWrite({
      merchantId: MERCHANT_ID,
      existingDynamicUserId: null,
      incomingDynamicUserId: MERCHANT_ID,
      ownershipProven: true,
    })
    expect(decision.action).toBe("noop")
    expect(decision).toMatchObject({ reason: "incoming_equals_merchant_id" })

    // Even with an existing legacy value and ownership proven, the merchant
    // id itself must never be written as dynamic_user_id.
    const decisionWithLegacyExisting = decideDynamicUserIdWrite({
      merchantId: MERCHANT_ID,
      existingDynamicUserId: MERCHANT_ID,
      incomingDynamicUserId: MERCHANT_ID,
      ownershipProven: true,
    })
    expect(decisionWithLegacyExisting.action).toBe("noop")
  })

  it("2. a legacy profile with dynamic_user_id equal to merchant_id is detected", () => {
    expect(isLegacyOrInvalidDynamicUserId(MERCHANT_ID, MERCHANT_ID)).toBe(true)
    expect(isLegacyOrInvalidDynamicUserId(null, MERCHANT_ID)).toBe(true)
    expect(isLegacyOrInvalidDynamicUserId("", MERCHANT_ID)).toBe(true)
    expect(isLegacyOrInvalidDynamicUserId(REAL_DYNAMIC_USER_ID, MERCHANT_ID)).toBe(false)
  })

  it("3. ownership-validated repair persists the correct Dynamic user ID", () => {
    const decision = decideDynamicUserIdWrite({
      merchantId: MERCHANT_ID,
      existingDynamicUserId: MERCHANT_ID, // legacy: stored value is the merchant UUID
      incomingDynamicUserId: REAL_DYNAMIC_USER_ID,
      ownershipProven: true,
    })
    expect(decision).toMatchObject({
      action: "write",
      dynamicUserId: REAL_DYNAMIC_USER_ID,
      reason: "legacy_repair",
    })
  })

  it("4. a different Dynamic identity without ownership proof remains blocked", () => {
    const legacyWithoutProof = decideDynamicUserIdWrite({
      merchantId: MERCHANT_ID,
      existingDynamicUserId: MERCHANT_ID,
      incomingDynamicUserId: REAL_DYNAMIC_USER_ID,
      ownershipProven: false,
    })
    expect(legacyWithoutProof).toMatchObject({
      action: "blocked",
      reason: "different_owner_without_ownership_proof",
    })

    // A stored value that is already a different, valid (non-legacy) Dynamic
    // id must never be silently replaced by a new claimed identity, even with
    // ownership proof for the incoming value - that would allow a different
    // Dynamic session to hijack an existing wallet profile.
    const differentValidOwner = decideDynamicUserIdWrite({
      merchantId: MERCHANT_ID,
      existingDynamicUserId: OTHER_VALID_DYNAMIC_USER_ID,
      incomingDynamicUserId: REAL_DYNAMIC_USER_ID,
      ownershipProven: true,
    })
    expect(differentValidOwner).toMatchObject({
      action: "blocked",
      reason: "existing_identity_already_valid_and_different",
    })
  })

  it("5b. no-ops (does not attempt a write) when incoming already matches stored - safe to continue", () => {
    const decision = decideDynamicUserIdWrite({
      merchantId: MERCHANT_ID,
      existingDynamicUserId: REAL_DYNAMIC_USER_ID,
      incomingDynamicUserId: REAL_DYNAMIC_USER_ID,
      ownershipProven: true,
    })
    expect(decision).toMatchObject({ action: "noop", reason: "matches_existing" })
  })

  it("9. initial provisioning writes the real Dynamic user id exactly once, no duplicate provisioning path", () => {
    const decision = decideDynamicUserIdWrite({
      merchantId: MERCHANT_ID,
      existingDynamicUserId: null,
      incomingDynamicUserId: REAL_DYNAMIC_USER_ID,
      ownershipProven: true,
    })
    expect(decision).toMatchObject({
      action: "write",
      dynamicUserId: REAL_DYNAMIC_USER_ID,
      reason: "initial_provision",
    })
  })
})

describe("Dynamic identity repair wired into the wallet profile route", () => {
  it("route never persists a raw pass-through of the incoming dynamic_user_id anymore", () => {
    expect(profileRoute).not.toContain('dynamicUserId: "dynamic_user_id" in body ? dynamicUserId : undefined,')
    expect(profileRoute).toContain("decideDynamicUserIdWrite")
    expect(profileRoute).toContain('dynamicUserId: dynamicIdentityDecision?.action === "write" ? dynamicIdentityDecision.dynamicUserId : undefined,')
  })

  it("a blocked identity decision returns a 409 conflict instead of writing", () => {
    const block = profileRoute.slice(
      profileRoute.indexOf('if (dynamicIdentityDecision?.action === "blocked")'),
      profileRoute.indexOf('if (dynamicIdentityDecision?.action === "write" && dynamicIdentityDecision.reason === "legacy_repair")')
    )
    expect(block).toContain('{ status: 409 }')
    expect(block).toContain("identityRepairAttempted: true")
    expect(block).toContain("identityRepairSucceeded: false")
  })

  it("a successful legacy repair is logged with ownership validation method and success flags", () => {
    const block = profileRoute.slice(
      profileRoute.indexOf('if (dynamicIdentityDecision?.action === "write" && dynamicIdentityDecision.reason === "legacy_repair")'),
      profileRoute.indexOf("const dynamicIdentityNeedsWrite")
    )
    expect(block).toContain("identityRepairAttempted: true")
    expect(block).toContain("identityRepairSucceeded: true")
    expect(block).toContain("ownershipValidationMethod")
  })

  it("the idempotent ready-profile shortcut does not skip a pending identity repair (no reprovisioning of healthy wallets otherwise)", () => {
    expect(profileRoute).toContain(
      "if (existingReadyProfile && baseAddressOwnedBySameMerchant && solanaAddressOwnedBySameMerchant && !dynamicIdentityNeedsWrite) {"
    )
  })
})

describe("Bounded Dynamic wallet hydration retry (walletCount = 0 handling)", () => {
  const page = read("app/dashboard/wallet-setup/page.tsx")
  const helper = page.slice(
    page.indexOf("const ensureDynamicWalletRuntimeReady = useCallback(async ("),
    page.indexOf("useEffect(() => {", page.indexOf("const ensureDynamicWalletRuntimeReady = useCallback(async ("))
  )

  it("6. retries a bounded number of times on DYNAMIC_WALLETS_HYDRATING instead of failing immediately", () => {
    expect(helper).toContain("for (let attempt = 1; attempt <= MAX_WALLET_HYDRATION_ATTEMPTS; attempt++)")
    expect(helper).toContain('if (snapshot.failureCode !== "DYNAMIC_WALLETS_HYDRATING")')
    expect(helper).toContain("break")
    // Bounded: a fixed numeric cap, not an unbounded/while(true) loop.
    expect(helper).toMatch(/MAX_WALLET_HYDRATION_ATTEMPTS = 3/)
    expect(helper).not.toContain("while (true)")
    expect(helper).not.toContain("while(true)")
  })

  it("throws only after the retry loop completes, using the post-loop snapshot", () => {
    const loopStart = helper.indexOf("for (let attempt = 1; attempt <= MAX_WALLET_HYDRATION_ATTEMPTS; attempt++)")
    const loopEnd = helper.indexOf("await new Promise((resolve) => setTimeout(resolve, WALLET_HYDRATION_RETRY_DELAY_MS * attempt))")
    const finalMismatchCheckIdx = helper.indexOf('if (snapshot.failureCode === "DYNAMIC_IDENTITY_MISMATCH") {', loopEnd)
    const finalGenericCheckIdx = helper.indexOf("if (snapshot.failureCode) {", loopEnd)
    expect(loopStart).toBeGreaterThan(0)
    expect(loopEnd).toBeGreaterThan(loopStart)
    expect(finalMismatchCheckIdx).toBeGreaterThan(loopEnd)
    expect(finalGenericCheckIdx).toBeGreaterThan(finalMismatchCheckIdx)
  })
})

describe("Base/Solana signer selection with multiple hydrated wallets present", () => {
  it("7. Base ETH/USDC selects the authenticated Base wallet, not the Solana one", () => {
    const baseWallet = {
      address: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
      key: "dynamicwaas-base",
      chain: "evm",
      getWalletClient: () => {},
    }
    const solanaWallet = {
      address: "SolanaHydrated11111111111111111111111111111",
      key: "dynamicwaas-solana",
      chain: "solana",
      signAndSendTransaction: () => {},
    }

    const selected = findDynamicApprovalWalletForSource(
      [solanaWallet as never, baseWallet as never],
      undefined,
      "base",
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
    )
    expect(selected).toBe(baseWallet)
  })

  it("8. Solana SOL/USDC selects the authenticated Solana wallet, not the Base one", () => {
    const baseWallet = {
      address: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
      key: "dynamicwaas-base",
      chain: "evm",
      getWalletClient: () => {},
    }
    const solanaWallet = {
      address: "SolanaHydrated11111111111111111111111111111",
      key: "dynamicwaas-solana",
      chain: "solana",
      signAndSendTransaction: () => {},
    }

    const selected = findDynamicApprovalWalletForSource(
      [baseWallet as never, solanaWallet as never],
      undefined,
      "solana",
      "SolanaHydrated11111111111111111111111111111"
    )
    expect(selected).toBe(solanaWallet)
  })
})

describe("Speed Bitcoin withdrawals are unaffected by the Dynamic identity fix", () => {
  it("10. Bitcoin withdrawals use manual_review approval and never reach the Dynamic identity/ownership machinery", () => {
    const page = read("app/dashboard/wallet-setup/page.tsx")
    // Bitcoin withdrawals are prepared with approvalMethod "manual_review",
    // never "dynamic_browser".
    expect(page).toContain('approvalMethod: "manual_review",')
    expect(page).toContain('message: "Confirm this Bitcoin Lightning withdrawal."')
    // ensureDynamicWalletRuntimeReady (the function this fix changes) is only
    // ever invoked once in the whole file, and only inside the
    // approvalMethod === "dynamic_browser" branch of submit - i.e. never for
    // Bitcoin, which always uses manual_review.
    const callSites = page.split("ensureDynamicWalletRuntimeReady(").length - 1
    expect(callSites).toBe(1) // only one call site in the whole file
    const dynamicBrowserGateIdx = page.indexOf('if (review.review.approvalMethod === "dynamic_browser") {')
    const callSiteIdx = page.indexOf("await ensureDynamicWalletRuntimeReady(")
    expect(dynamicBrowserGateIdx).toBeGreaterThan(0)
    expect(callSiteIdx).toBeGreaterThan(dynamicBrowserGateIdx)
    // And the reverse: the manual_review (Bitcoin) branch explicitly rejects
    // before ever reaching the dynamic_browser-only code path.
    expect(page).toContain('if (review.review.approvalMethod !== "dynamic_browser") {')
  })
})
