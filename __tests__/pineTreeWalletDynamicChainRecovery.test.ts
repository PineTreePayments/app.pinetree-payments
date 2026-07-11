import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

const page = read("app/dashboard/wallet-setup/page.tsx")
const eventRoute = read("app/api/debug/pinetree-wallet/setup-event/route.ts")

describe("Dynamic hydration single-flight is bounded, not reused indefinitely (Part A)", () => {
  it("a stale in-flight promise is evicted instead of awaited forever", () => {
    const wrapperFn = page.slice(
      page.indexOf("const refreshDynamicWalletRuntime = useCallback((reason: string"),
      page.indexOf("}, [refreshDynamicWalletRuntimeImpl, sdkHasLoaded, user])")
    )
    expect(wrapperFn).toContain("const meta = walletRuntimeRefreshMetaRef.current[refreshMode]")
    expect(wrapperFn).toContain("const ageMs = meta ? Date.now() - meta.startedAt : 0")
    expect(wrapperFn).toContain("const stale = ageMs >= dynamicHydrationSingleFlightTimeoutMs")
    expect(wrapperFn).toContain("wallet_dynamic_refresh_singleflight_reused")
    expect(wrapperFn).toContain("wallet_dynamic_refresh_singleflight_timed_out")
    expect(wrapperFn).toContain("wallet_dynamic_refresh_singleflight_replaced")
    expect(wrapperFn).toContain("wallet_dynamic_refresh_singleflight_started")
    // Original single-flight contract (reused by other tests) stays intact.
    expect(wrapperFn).toContain("const alreadyInFlight = walletRuntimeRefreshInFlightRef.current[refreshMode]")
    expect(wrapperFn).toContain("if (alreadyInFlight) {")
    expect(wrapperFn).toContain("return alreadyInFlight")
    expect(wrapperFn).toContain("walletRuntimeRefreshInFlightRef.current[refreshMode] = runPromise")
  })

  it("clearing the in-flight ref on completion is guarded by a generation match so a superseded promise can't clear a newer attempt", () => {
    const wrapperFn = page.slice(
      page.indexOf("const refreshDynamicWalletRuntime = useCallback((reason: string"),
      page.indexOf("}, [refreshDynamicWalletRuntimeImpl, sdkHasLoaded, user])")
    )
    expect(wrapperFn).toContain("const currentMeta = walletRuntimeRefreshMetaRef.current[refreshMode]")
    expect(wrapperFn).toContain("if (currentMeta && currentMeta.generation === generation) {")
    expect(wrapperFn).toContain("wallet_dynamic_refresh_singleflight_cleared")
  })

  it("declares a bounded hydration timeout constant in the 10-15s range", () => {
    expect(page).toContain("const dynamicHydrationSingleFlightTimeoutMs = 12_000")
  })

  it("new single-flight events are whitelisted for the server-visible beacon", () => {
    for (const event of [
      "wallet_dynamic_refresh_singleflight_started",
      "wallet_dynamic_refresh_singleflight_reused",
      "wallet_dynamic_refresh_singleflight_timed_out",
      "wallet_dynamic_refresh_singleflight_replaced",
      "wallet_dynamic_refresh_singleflight_cleared",
    ]) {
      expect(eventRoute).toContain(`"${event}"`)
    }
  })
})

describe("Explicit missing-chain provisioning (Part B)", () => {
  it("a runtime wallet count above zero still evaluates per-chain required state instead of skipping creation entirely", () => {
    const implFn = page.slice(
      page.indexOf("const refreshDynamicWalletRuntimeImpl = useCallback"),
      page.indexOf("// Single-flight wrapper")
    )
    expect(implFn).toContain("if (runtimeWallets.length === 0) {")
    // The new per-chain branch runs in the else of that same gate - the exact bug
    // (runtimeWalletCount: 1 but both addresses still missing) was that nothing ever
    // ran once the count left zero.
    expect(implFn).toContain("computeRequiredChainState({")
    expect(implFn).toContain("const missingBaseChain = !hasBaseCredential && !hasBaseRuntimeWallet")
    expect(implFn).toContain("const missingSolanaChain = !hasSolanaCredential && !hasSolanaRuntimeWallet")
  })

  it("Base and Solana creation are tracked and guarded independently", () => {
    const implFn = page.slice(
      page.indexOf("const refreshDynamicWalletRuntimeImpl = useCallback"),
      page.indexOf("// Single-flight wrapper")
    )
    expect(implFn).toContain("createWalletAccount([{ chain: \"EVM\" }]")
    expect(implFn).toContain("createWalletAccount([{ chain: \"SOL\" }]")
    expect(implFn).toContain("baseWalletCreateGuardRef.current = Date.now()")
    expect(implFn).toContain("solanaWalletCreateGuardRef.current = Date.now()")
    expect(implFn).toContain("wallet_dynamic_base_create_started")
    expect(implFn).toContain("wallet_dynamic_base_create_failed")
    expect(implFn).toContain("wallet_dynamic_solana_create_started")
    expect(implFn).toContain("wallet_dynamic_solana_create_failed")
    // A failure on one chain must be distinguishable from the other.
    expect(implFn).toContain("baseWalletCreateFailedRef.current = true")
    expect(implFn).toContain("solanaWalletCreateFailedRef.current = true")
  })

  it("a chain with an existing credential but no runtime wallet restores instead of duplicate-creating", () => {
    const implFn = page.slice(
      page.indexOf("const refreshDynamicWalletRuntimeImpl = useCallback"),
      page.indexOf("// Single-flight wrapper")
    )
    expect(implFn).toContain("(hasBaseCredential && !hasBaseRuntimeWallet) ||")
    expect(implFn).toContain("(hasSolanaCredential && !hasSolanaRuntimeWallet)")
  })

  it("per-chain create guards expire after a bounded timeout instead of blocking retries forever", () => {
    expect(page).toContain("const dynamicChainCreateTimeoutMs = 25_000")
    expect(page).toContain("function chainCreateGuardActive(guardRef: { current: number | null }) {")
    expect(page).toContain("if (Date.now() - startedAt > dynamicChainCreateTimeoutMs) {")
  })

  it("new required-chain events are whitelisted for the server-visible beacon", () => {
    for (const event of [
      "wallet_dynamic_required_chain_state",
      "wallet_dynamic_base_create_started",
      "wallet_dynamic_base_create_complete",
      "wallet_dynamic_base_create_failed",
      "wallet_dynamic_solana_create_started",
      "wallet_dynamic_solana_create_complete",
      "wallet_dynamic_solana_create_failed",
      "wallet_dynamic_required_chains_complete",
    ]) {
      expect(eventRoute).toContain(`"${event}"`)
    }
  })
})

describe("setupAttemptActive reflects a ref, not just stale render-cycle state (Part D)", () => {
  it("computes setupAttemptActive from overallSetupActiveRef ORed with the existing signals", () => {
    expect(page).toContain(
      "setupAttemptActive: Boolean(overallSetupActiveRef.current || pendingSync || walletSetupStartInFlightRef.current)"
    )
  })

  it("marks overallSetupActiveRef true before the dynamic-auth-complete diagnostic fires for both external JWT and native auth resume", () => {
    const externalJwtBlock = page.slice(
      page.indexOf('throw Object.assign(new Error("dynamic_external_auth_no_user")'),
      page.indexOf('emitWalletSetupStageDiagnostic("wallet_create_dynamic_auth_complete", "dynamic_auth_complete")')
    )
    expect(externalJwtBlock).toContain("overallSetupActiveRef.current = true")

    const nativeResumeBlock = page.slice(
      page.indexOf("nativeFallbackPendingRef.current = false"),
      page.indexOf('emitWalletSetupStageDiagnostic("wallet_create_dynamic_auth_complete", "native_dynamic_auth_complete")')
    )
    expect(nativeResumeBlock).toContain("overallSetupActiveRef.current = true")
  })

  it("clears overallSetupActiveRef at the two definitive conclusion points: bounded timeout failure and ready-profile cleanup", () => {
    const timeoutBlock = page.slice(
      page.indexOf("setProvisioningRetryExhausted(true)"),
      page.indexOf("setWalletCreationStep(\"timeout\")")
    )
    expect(timeoutBlock).toContain("overallSetupActiveRef.current = false")

    const readyCleanupStart = page.indexOf("walletSetupStartInFlightRef.current = null\n    overallSetupActiveRef.current = false")
    const readyCleanupBlock = page.slice(
      readyCleanupStart,
      page.indexOf('setWalletCreationStep("profile_synced")', readyCleanupStart)
    )
    expect(readyCleanupBlock).toContain("overallSetupActiveRef.current = false")
  })
})

describe("Bounded user-facing failure instead of an indefinite freeze (Part F)", () => {
  it("declares the new chain-recovery failure reasons", () => {
    for (const reason of [
      '"dynamic_required_chains_incomplete"',
      '"dynamic_hydration_timeout"',
      '"dynamic_base_creation_failed"',
      '"dynamic_solana_creation_failed"',
    ]) {
      expect(page).toContain(reason)
    }
  })

  it("maps the new reasons to the chain-recovery specific merchant-safe copy, not the generic or identity copy", () => {
    const messageFn = page.slice(
      page.indexOf("function walletSetupFailureMessage(reason: WalletSetupFailureReason | null)"),
      page.indexOf("function walletSetupFailureRecoveryLabel")
    )
    expect(messageFn).toContain(
      "PineTree Wallet setup could not finish creating the required wallet networks. Please try again."
    )
    expect(messageFn).toContain("dynamic_required_chains_incomplete")
    expect(messageFn).toContain("dynamic_hydration_timeout")
    expect(messageFn).toContain("dynamic_base_creation_failed")
    expect(messageFn).toContain("dynamic_solana_creation_failed")
  })

  it("infers the specific creation-failure reason instead of the generic address-missing reason when a chain create actually failed", () => {
    const inferFn = page.slice(
      page.indexOf("function inferWalletSetupFailureReason(): WalletSetupFailureReason"),
      page.indexOf('return "provisioning_timeout_unknown"')
    )
    expect(inferFn).toContain("if (!baseAddress && !solanaAddress) return \"dynamic_required_chains_incomplete\"")
    expect(inferFn).toContain("if (baseWalletCreateFailedRef.current) return \"dynamic_base_creation_failed\"")
    expect(inferFn).toContain("if (solanaWalletCreateFailedRef.current) return \"dynamic_solana_creation_failed\"")
    // Generic reasons remain reachable when no explicit create was attempted/failed.
    expect(inferFn).toContain('return "base_address_missing"')
    expect(inferFn).toContain('return "solana_address_missing"')
  })

  it("still uses a single retry action (Try Again) rather than a new bespoke button", () => {
    expect(page).toContain('"Try Again"')
    expect(page).toContain("function walletSetupFailureRecoveryLabel(_reason: WalletSetupFailureReason | null) {")
  })
})
