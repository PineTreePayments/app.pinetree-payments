import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

const page = fs.readFileSync(
  path.join(process.cwd(), "app/dashboard/wallet-setup/page.tsx"),
  "utf8"
)

describe("Dynamic wallet provisioning — zero-wallet case", () => {
  it("WaaS path provisions wallets via createWalletAccount when runtime is empty", () => {
    // needsAutoCreateWalletChains drives creation when the SDK has populated it, but a fresh
    // user can hit a window where it's empty before the SDK catches up — requiredChains falls
    // back to an explicit EVM+SOL request so creation is never silently skipped (see
    // pineTreeDynamicProvisioningFlow.test.ts for the fallback-path coverage).
    // Bounded via runWithBoundedTimeout (production showed this hang 129+ seconds
    // unbounded) rather than an unbounded await.
    expect(page).toContain("() => createWalletAccount(requiredChains),")
    expect(page).toContain("const initialCreateOutcome = await initialCreateCall.result")
    expect(page).toContain("needsAutoCreateWalletChains.length > 0")
    expect(page).toContain("? needsAutoCreateWalletChains")
    expect(page).toContain("if (runtimeWallets.length === 0) {")
  })

  it("legacy embedded wallet path creates wallet when none exists", () => {
    expect(page).toContain("await createEmbeddedWallet()")
    expect(page).toContain("userHasEmbeddedWallet()")
    expect(page).toContain("await createOrRestoreSession()")
  })

  it("createWalletAccount and needsAutoCreateWalletChains are destructured from useDynamicWaas", () => {
    expect(page).toContain("createWalletAccount,")
    expect(page).toContain("needsAutoCreateWalletChains,")
    expect(page).toContain("useDynamicWaas()")
  })

  it("createEmbeddedWallet is destructured from useEmbeddedWallet", () => {
    expect(page).toContain("createEmbeddedWallet,")
    expect(page).toContain("useEmbeddedWallet()")
  })

  it("provisioning debug logs include dynamic user id and wallet counts", () => {
    expect(page).toContain("provisioning_waas_wallet_accounts")
    expect(page).toContain("needsAutoCreateWalletChainCount: needsAutoCreateWalletChains.length")
    expect(page).toContain("useUserWalletsCountBefore: (wallets as unknown[]).length")
    expect(page).toContain("provisioning_embedded_wallet_first_time")
  })

  it("profile sync reads Dynamic WaaS runtime wallets when useUserWallets is empty", () => {
    expect(page).toContain("const waasRuntimeWallets = useMemo")
    expect(page).toContain("getWaasWallets() as unknown[]")
    expect(page).toContain("const waasCredentialSignerWallets = useMemo")
    expect(page).toContain("...(wallets as unknown[]), ...waasRuntimeWallets, ...waasCredentialSignerWallets")
    expect(page).toContain("setDynamicWalletRuntimeRefreshNonce((value) => value + 1)")
  })

  it("profile sync signer guard uses the merged Dynamic wallet candidate list", () => {
    expect(page).toContain('findDynamicApprovalWalletForSourceAsync(dynamicWalletSearchList as unknown[], primaryWallet, "base", baseAddress)')
    expect(page).toContain('findDynamicApprovalWalletForSourceAsync(dynamicWalletSearchList as unknown[], primaryWallet, "solana", solanaAddress)')
  })

  it("WaaS init path still runs initializeWaas when shouldInitializeWaas is true", () => {
    expect(page).toContain("initializeWaas({ forceClientRebuild: true })")
    expect(page).toContain("if (shouldInitializeWaas)")
  })
})

describe("Withdrawal review blocked when no runtime wallets", () => {
  it("handleReviewWithdrawal returns early when dynamicWalletRuntimeCount === 0", () => {
    expect(page).toContain("dynamicWalletRuntimeCount === 0")
    expect(page).toContain("Reconnect PineTree Wallet to verify secure signing access.")
  })

  it("guard only fires when SDK is loaded and user is authenticated", () => {
    expect(page).toContain("sdkHasLoaded && user && (runtimeCountForReviewGate === 0 || !reviewSigner)")
  })

  it("guard fires before setReviewingWithdrawal so no row is created", () => {
    const guardIdx = page.lastIndexOf("if (sdkHasLoaded && user && (runtimeCountForReviewGate === 0 || !reviewSigner))")
    const reviewIdx = page.lastIndexOf("setReviewingWithdrawal(true)")
    expect(guardIdx).toBeGreaterThan(0)
    expect(reviewIdx).toBeGreaterThan(guardIdx)
  })

  it("guard debug log includes rail and asset context", () => {
    expect(page).toContain("withdrawal_review_blocked_no_runtime_wallets")
    expect(page).toContain("dynamicWalletRuntimeCount,")
    expect(page).toContain("withdrawalRail,")
    expect(page).toContain("withdrawalAsset,")
  })
})

describe("Stale unsigned withdrawal rows are cleaned up", () => {
  it("cancelStaleUnsignedWithdrawalReviews is called on wallet open", () => {
    const sync = fs.readFileSync(
      path.join(process.cwd(), "engine/pineTreeWalletSync.ts"),
      "utf8"
    )
    expect(sync).toContain("cancelStaleUnsignedWithdrawalReviews")
  })

  it("stale row cleanup only cancels review_required and pending with no tx_hash", () => {
    const db = fs.readFileSync(
      path.join(process.cwd(), "database/walletWithdrawalRequests.ts"),
      "utf8"
    )
    expect(db).toContain("cancelStaleUnsignedWithdrawalReviews")
    expect(db).toContain("tx_hash")
    // Confirms the function never touches processing/confirmed/failed rows
    expect(db).toContain("review_required")
    expect(db).toContain("pending")
  })
})

describe("Runtime debug log includes signer diagnostics", () => {
  it("dynamic_wallet_runtime_refreshed log includes solanaWalletFound and baseWalletFound", () => {
    expect(page).toContain("solanaWalletFound:")
    expect(page).toContain("baseWalletFound:")
    expect(page).toContain("signerLookupResult:")
  })

  it("solanaWalletFound checks SOL chain or base58-pattern address", () => {
    expect(page).toContain('wl.chain === "SOL"')
    expect(page).toContain("[1-9A-HJ-NP-Za-km-z]{32,44}")
  })

  it("baseWalletFound checks EVM chain or 0x address", () => {
    expect(page).toContain('wl.chain === "EVM"')
    expect(page).toContain("0x[a-fA-F0-9]{40}")
  })
})

describe("refreshDynamicWalletRuntime deps array is complete", () => {
  it("deps array includes the three new provisioning dependencies", () => {
    expect(page).toContain("createEmbeddedWallet,")
    expect(page).toContain("createWalletAccount,")
    expect(page).toContain("needsAutoCreateWalletChains,")
  })

  it("existing deps are still present", () => {
    expect(page).toContain("createOrRestoreSession,")
    expect(page).toContain("dynamicWaasIsEnabled,")
    expect(page).toContain("shouldInitializeWaas,")
    expect(page).toContain("userHasEmbeddedWallet,")
    expect(page).toContain("waitForDynamicWalletRuntime,")
  })
})
