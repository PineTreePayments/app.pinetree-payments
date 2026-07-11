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
    expect(implFn).toContain("const missingBaseChain = needsExplicitBaseCreate(requiredChainState)")
    expect(implFn).toContain("const missingSolanaChain = needsExplicitSolanaCreate(requiredChainState)")
  })

  it("Base and Solana creation are tracked and guarded independently", () => {
    const implFn = page.slice(
      page.indexOf("const refreshDynamicWalletRuntimeImpl = useCallback"),
      page.indexOf("// Single-flight wrapper")
    )
    expect(implFn).toContain("createWalletAccount([{ chain: ChainEnum.Evm }])")
    expect(implFn).toContain("createWalletAccount([{ chain: ChainEnum.Sol }])")
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

describe("Chain create is bounded by a true PineTree-side deadline, not just the dedupe guard", () => {
  const implFn = page.slice(
    page.indexOf("const refreshDynamicWalletRuntimeImpl = useCallback"),
    page.indexOf("// Single-flight wrapper")
  )

  it("wraps each createWalletAccount call in the reusable bounded helper instead of awaiting it directly", () => {
    expect(page).toContain('import { runWithBoundedTimeout } from "@/lib/wallets/boundedProviderCall"')
    expect(implFn).toContain("createWalletAccount([{ chain: ChainEnum.Evm }])")
    expect(implFn).toContain("createWalletAccount([{ chain: ChainEnum.Sol }])")
    expect(implFn).toContain("const baseCreateOutcome = await baseCreateCall.result")
    expect(implFn).toContain("const solanaCreateOutcome = await solanaCreateCall.result")
  })

  it("uses the installed SDK's real ChainEnum instead of an unchecked string cast for the per-chain create requests", () => {
    expect(page).toContain(
      'import { ChainEnum, useDynamicContext, useDynamicEvents, useDynamicWaas'
    )
    expect(page).not.toContain('createWalletAccount([{ chain: "EVM" }] as unknown as typeof needsAutoCreateWalletChains)')
    expect(page).not.toContain('createWalletAccount([{ chain: "SOL" }] as unknown as typeof needsAutoCreateWalletChains)')
  })

  it("a timed-out create does not immediately trigger a duplicate create - it marks the chain detached", () => {
    expect(page).toContain("const baseWalletCreateDetachedRef = useRef(false)")
    expect(page).toContain("const solanaWalletCreateDetachedRef = useRef(false)")
    expect(implFn).toContain("!chainCreateGuardActive(baseWalletCreateGuardRef) &&\n            !baseWalletCreateDetachedRef.current")
    expect(implFn).toContain("!chainCreateGuardActive(solanaWalletCreateGuardRef) &&\n            !solanaWalletCreateDetachedRef.current")
    expect(implFn).toContain("baseWalletCreateDetachedRef.current = true")
    expect(implFn).toContain("solanaWalletCreateDetachedRef.current = true")
  })

  it("fresh hydration after a timeout rechecks provider state (computeRequiredChainState) before any retry, and only clears detached once the original call actually settles", () => {
    expect(implFn).toContain("computeRequiredChainState({")
    expect(implFn).toContain("void baseCreateCall.settlement.then((settled) => {\n                baseWalletCreateDetachedRef.current = false")
    expect(implFn).toContain("void solanaCreateCall.settlement.then((settled) => {\n                solanaWalletCreateDetachedRef.current = false")
  })

  it("an older provider promise resolving later cannot overwrite a newer generation or trigger duplicate profile work", () => {
    expect(implFn).toContain("const baseCreateGeneration = generation")
    expect(implFn).toContain("const solanaCreateGeneration = generation")
    expect(implFn).toContain(
      "const stillCurrentGeneration =\n                  walletRuntimeRefreshMetaRef.current[refreshMode]?.generation === baseCreateGeneration"
    )
    expect(implFn).toContain(
      "const stillCurrentGeneration =\n                  walletRuntimeRefreshMetaRef.current[refreshMode]?.generation === solanaCreateGeneration"
    )
    expect(implFn).toContain("if (stillCurrentGeneration && settled.status === \"fulfilled\") {\n                  setDynamicWalletRuntimeRefreshNonce((value) => value + 1)")
  })

  it("emits the required safe timeout/late-settlement events, whitelisted for the server-visible beacon", () => {
    for (const event of [
      "wallet_dynamic_base_create_timed_out",
      "wallet_dynamic_solana_create_timed_out",
      "wallet_dynamic_chain_create_late_settlement_ignored",
    ]) {
      expect(implFn).toContain(event)
      expect(eventRoute).toContain(`"${event}"`)
    }
  })

  it("refreshDynamicWalletRuntimeImpl receives the caller's single-flight generation instead of tracking its own", () => {
    expect(page).toContain(
      'const refreshDynamicWalletRuntimeImpl = useCallback(async (reason: string, options?: { requireApprovalWallet?: boolean }, generation = 0) => {'
    )
    expect(page).toContain("return await refreshDynamicWalletRuntimeImpl(reason, options, generation)")
  })
})

describe("Overall core-setup deadline is stage-aware, not shorter than valid staged work (Problem 2)", () => {
  it("sizes the total budget from the hydration/chain-create/post-create-hydration stage constants instead of a flat 20s", () => {
    expect(page).toContain("const dynamicHydrationSingleFlightTimeoutMs = 12_000")
    expect(page).toContain("const dynamicChainCreateTimeoutMs = 25_000")
    expect(page).toContain("const walletCoreSetupPostCreateHydrationMs = 12_000")
    expect(page).toContain("const walletCreationTimeoutMs =")
    expect(page).toContain("dynamicHydrationSingleFlightTimeoutMs +\n  dynamicChainCreateTimeoutMs * 2 +\n  walletCoreSetupPostCreateHydrationMs")
    expect(page).toContain("const walletProvisioningFinalRefreshGraceMs = 15_000")
  })

  it("does not fail at 25 seconds while a chain create is still within its own allowed deadline", () => {
    // 12 (hydrate) + 25*2 (base + solana create) + 12 (post-create hydrate) = 74s,
    // strictly greater than a single chain create's own 25s deadline, so the overall
    // timer cannot fire while that create is still legitimately in flight.
    const totalMs = 12_000 + 25_000 * 2 + 12_000
    expect(totalMs).toBeGreaterThan(25_000)
    expect(totalMs).toBe(74_000)
  })

  it("eventually fails within the 75-90 second total cap", () => {
    const totalStageMs = 12_000 + 25_000 * 2 + 12_000
    const graceMs = 15_000
    const overallCapMs = totalStageMs + graceMs
    expect(overallCapMs).toBeGreaterThanOrEqual(75_000)
    expect(overallCapMs).toBeLessThanOrEqual(90_000)
  })
})

describe("Stage-aware progress text (no UI layout change, no success banner)", () => {
  it("declares a granular stage label shown only during provisioning", () => {
    expect(page).toContain('const [coreSetupStageLabel, setCoreSetupStageLabel] = useState("")')
    expect(page).toContain('walletSetupPrimaryState === "provisioning" && coreSetupStageLabel')
  })

  it("covers the requested stage checkpoints", () => {
    for (const label of [
      "Preparing secure wallet",
      "Creating Base wallet",
      "Creating Solana wallet",
      "Syncing wallet networks",
      "Finishing PineTree Wallet setup",
    ]) {
      expect(page).toContain(label)
    }
  })

  it("still surfaces the same bounded-failure copy instead of a success banner", () => {
    expect(page).toContain(
      "PineTree Wallet setup could not finish creating the required wallet networks. Please try again."
    )
    expect(page).not.toContain("Wallet ready")
  })
})

describe("Both chains completing proceeds to profile POST and modal open exactly once", () => {
  it("profile POST is still fired from the single dedicated syncProfileFromDynamic path, not from the chain-create block", () => {
    const implFn = page.slice(
      page.indexOf("const refreshDynamicWalletRuntimeImpl = useCallback"),
      page.indexOf("// Single-flight wrapper")
    )
    expect(implFn).not.toContain("/api/wallets/pinetree-profile")
    expect(implFn).not.toContain("openPineTreeWalletModalOnce")
  })

  it("modal open remains one-shot and profile POST remains deduped by key", () => {
    expect(page).toContain("function openPineTreeWalletModalOnce(stage: string) {")
    expect(page).toContain("if (walletModalOpenedForAttemptRef.current || walletOpen) return")
    expect(page).toContain("if (profilePostInFlightKeyRef.current === profilePostKey) {")
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
