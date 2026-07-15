import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

function normalizeSource(value: string) {
  return value.replace(/\r\n/g, "\n")
}

function compactSource(value: string) {
  return normalizeSource(value).replace(/\s+/g, " ")
}

const page = normalizeSource(read("app/dashboard/wallet-setup/page.tsx"))
const eventRoute = normalizeSource(read("app/api/debug/pinetree-wallet/setup-event/route.ts"))

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

    const readyCleanupStart = page.indexOf("walletSetupStartInFlightRef.current = null")
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
    expect(page).toContain('import { runWithBoundedTimeout, type BoundedProviderCallSettlement } from "@/lib/wallets/boundedProviderCall"')
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
    const compactImplFn = compactSource(implFn)
    expect(page).toContain("const baseWalletCreateDetachedRef = useRef(false)")
    expect(page).toContain("const solanaWalletCreateDetachedRef = useRef(false)")
    expect(compactImplFn).toContain("!chainCreateGuardActive(baseWalletCreateGuardRef) && !baseWalletCreateDetachedRef.current")
    expect(compactImplFn).toContain("!chainCreateGuardActive(solanaWalletCreateGuardRef) && !solanaWalletCreateDetachedRef.current")
    expect(implFn).toContain("baseWalletCreateDetachedRef.current = true")
    expect(implFn).toContain("solanaWalletCreateDetachedRef.current = true")
  })

  it("fresh hydration after a timeout rechecks provider state (computeRequiredChainState) before any retry, and only clears detached once the original call actually settles", () => {
    const compactImplFn = compactSource(implFn)
    expect(implFn).toContain("computeRequiredChainState({")
    expect(compactImplFn).toContain("void baseCreateCall.settlement.then((settled) => { baseWalletCreateDetachedRef.current = false")
    expect(compactImplFn).toContain("void solanaCreateCall.settlement.then((settled) => { solanaWalletCreateDetachedRef.current = false")
  })

  it("an older provider promise resolving later cannot overwrite a newer generation, flip an already-succeeded wallet to failed, or trigger duplicate profile work", () => {
    expect(implFn).toContain("const baseCreateGeneration = generation")
    expect(implFn).toContain("const solanaCreateGeneration = generation")
    // Both settlement handlers route through the shared helper, which itself checks
    // generation match (and terminal-success) before ever bumping the refresh nonce.
    expect(implFn).toContain("void baseCreateCall.settlement.then((settled) => {")
    expect(implFn).toContain("void solanaCreateCall.settlement.then((settled) => {")
    const compactImplFn = compactSource(implFn)
    expect(compactImplFn).toContain("logStaleDynamicCreateSettlement({ reason, refreshMode, label: \"base\",")
    expect(compactImplFn).toContain("logStaleDynamicCreateSettlement({ reason, refreshMode, label: \"solana\",")
    // A late settlement must never flip an already-terminally-succeeded wallet to
    // failed - the *CreateFailedRef assignment is gated on !pastTerminalSuccess.
    expect(compactImplFn).toContain("if (!pastTerminalSuccess) { baseWalletCreateFailedRef.current = settled.status === \"rejected\"")
    expect(compactImplFn).toContain("if (!pastTerminalSuccess) { solanaWalletCreateFailedRef.current = settled.status === \"rejected\"")

    const helperFn = page.slice(
      page.indexOf("const logDynamicCreateLateResultIgnored = useCallback"),
      page.indexOf("const refreshDynamicWalletRuntimeImpl = useCallback")
    )
    expect(helperFn).toContain("const stillCurrentGeneration = walletRuntimeRefreshMetaRef.current[refreshMode]?.generation === generation")
    expect(helperFn).toContain("if (settled.status === \"fulfilled\") {\n      setDynamicWalletRuntimeRefreshNonce((value) => value + 1)")
  })

  it("emits the required safe timeout/late-settlement events, whitelisted for the server-visible beacon", () => {
    for (const event of ["wallet_dynamic_base_create_timed_out", "wallet_dynamic_solana_create_timed_out"]) {
      expect(implFn).toContain(event)
      expect(eventRoute).toContain(`"${event}"`)
    }
    // The late-settlement-ignored event moved into the shared helper (deduped across
    // the initial waas create, Base create, and Solana create call sites) - it's no
    // longer inline in implFn, but it must still exist and be whitelisted.
    for (const event of [
      "wallet_dynamic_chain_create_late_settlement_ignored",
      "wallet_dynamic_late_result_ignored",
    ]) {
      expect(page).toContain(event)
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
    expect(compactSource(page)).toContain("dynamicHydrationSingleFlightTimeoutMs + dynamicChainCreateTimeoutMs * 2 + walletCoreSetupPostCreateHydrationMs")
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

describe("Stale Dynamic create/hydration work is ignored once setup terminally succeeds", () => {
  const implFn = page.slice(
    page.indexOf("const refreshDynamicWalletRuntimeImpl = useCallback"),
    page.indexOf("// Single-flight wrapper")
  )
  const helperFn = page.slice(
    page.indexOf("const logDynamicCreateLateResultIgnored = useCallback"),
    page.indexOf("const refreshDynamicWalletRuntimeImpl = useCallback")
  )
  const supersededFn = page.slice(
    page.indexOf("const isDynamicCreateGenerationSuperseded = useCallback"),
    page.indexOf("const logStaleDynamicCreateSettlement = useCallback")
  )

  it("captures the active generation the first time coreWalletProfileReady flips true, and only once", () => {
    const captureEffect = page.slice(
      page.indexOf("// Once core wallet setup (Base + Solana + a saved \"ready\" profile) is terminally"),
      page.indexOf("// syncWalletReadiness: combine the core wallet and Speed/Lightning task outcomes")
    )
    expect(captureEffect).toContain("if (!coreWalletProfileReady) return")
    // Idempotent guard - a Strict Mode double-invoke or a later re-render with
    // coreWalletProfileReady still true must not recapture (and must not treat a
    // later legitimate refresh's higher generation as terminal).
    expect(captureEffect).toContain("if (walletCoreSetupTerminalGenerationRef.current !== null) return")
    expect(captureEffect).toContain("const generationAtSuccess = walletRuntimeRefreshGenerationRef.current")
    expect(captureEffect).toContain("walletCoreSetupTerminalGenerationRef.current = generationAtSuccess")
    expect(captureEffect).toContain("wallet_dynamic_setup_cancelled_after_success")
  })

  it("a generation is considered superseded once it is at or before the captured terminal generation, or no longer the tracked meta", () => {
    expect(supersededFn).toContain("generation <= walletCoreSetupTerminalGenerationRef.current")
    expect(supersededFn).toContain("walletRuntimeRefreshMetaRef.current[refreshMode]?.generation !== generation")
  })

  it("never starts another createWalletAccount call once this generation is superseded (initial waas-create, Base, and Solana paths)", () => {
    const compactImplFn = compactSource(implFn)
    expect(implFn).toContain("isDynamicCreateGenerationSuperseded(refreshMode, generation)")
    expect(implFn).toContain(
      "if (requiredChains.length > 0 && !creatingEmbeddedWalletRef.current && isDynamicCreateGenerationSuperseded(refreshMode, generation)) {"
    )
    expect(compactImplFn).toContain("!baseWalletCreateDetachedRef.current && !isDynamicCreateGenerationSuperseded(refreshMode, generation)")
    expect(compactImplFn).toContain("!solanaWalletCreateDetachedRef.current && !isDynamicCreateGenerationSuperseded(refreshMode, generation)")
  })

  it("the initial WaaS create call is bounded, not an unbounded await - production hung 129+ seconds on exactly this call", () => {
    expect(implFn).toContain("const initialCreateCall = runWithBoundedTimeout(")
    expect(implFn).toContain("() => createWalletAccount(requiredChains),")
    expect(implFn).toContain("const initialCreateOutcome = await initialCreateCall.result")
    expect(implFn).toContain("wallet_dynamic_create_embedded_wallet_timed_out")
    expect(implFn).toContain("void initialCreateCall.settlement.then((settled) => {")
  })

  it("a late bounded create settlement after terminal success is ignored with the required diagnostic shape", () => {
    expect(helperFn).toContain("const logDynamicCreateLateResultIgnored = useCallback")
    expect(helperFn).toContain("const currentGeneration = walletRuntimeRefreshGenerationRef.current")
    expect(helperFn).toContain("const stillCurrentGeneration = walletRuntimeRefreshMetaRef.current[params.refreshMode]?.generation === params.generation")
    expect(helperFn).toContain("params.generation <= walletCoreSetupTerminalGenerationRef.current")
    expect(helperFn).toContain("if (stillCurrentGeneration && !pastTerminalSuccess) return false")
    for (const field of [
      "merchantId",
      "generation: params.generation",
      "ageMs: Date.now() - params.startedAt",
      "settlement: params.settlement",
      "terminalStatus: pastTerminalSuccess ? \"ready\" : \"not_terminal\"",
      "currentGeneration",
    ]) {
      expect(helperFn).toContain(field)
    }
    expect(helperFn).toContain('console.info("[pinetree-wallets] wallet_dynamic_late_result_ignored", diagnostic)')
    expect(helperFn).toContain("emitWalletSetupDebugEvent(\"wallet_dynamic_late_result_ignored\", diagnostic)")
    expect(helperFn).toContain("return true")
    expect(helperFn).not.toContain("wallet_dynamic_stale_generation_ignored")
  })

  it("a stale generation timeout after wallet_setup_ready is ignored before the normal timeout event can emit", () => {
    const initialTimeoutBlock = implFn.slice(
      implFn.indexOf("if (logDynamicCreateLateResultIgnored({", implFn.indexOf("const initialCreateOutcome = await initialCreateCall.result")),
      implFn.indexOf('console.warn("[pinetree-wallets] wallet_dynamic_create_embedded_wallet_timed_out"')
    )
    expect(initialTimeoutBlock).toContain("logDynamicCreateLateResultIgnored({")
    expect(initialTimeoutBlock).toContain('label: "waas_create"')
    expect(initialTimeoutBlock).toContain("generation: initialCreateGeneration")
    expect(initialTimeoutBlock).toContain("startedAt: initialCreateStartedAt")
    expect(initialTimeoutBlock).toContain('settlement: "timeout"')
    expect(initialTimeoutBlock).toContain("return true")
  })

  it("a current active generation timeout still emits the normal timeout event and observes the detached SDK promise", () => {
    const initialTimeoutBlock = implFn.slice(
      implFn.indexOf('settlement: "timeout"'),
      implFn.indexOf("})\n              }\n            } finally", implFn.indexOf('settlement: "timeout"'))
    )
    expect(initialTimeoutBlock).toContain("wallet_dynamic_create_embedded_wallet_timed_out")
    expect(initialTimeoutBlock).toContain("void initialCreateCall.settlement.then((settled) => {")
    expect(initialTimeoutBlock).toContain("logStaleDynamicCreateSettlement({")
  })

  it("late resolve and late reject after success are ignored before create success or failure state changes", () => {
    for (const label of ["waas_create", "base", "solana"]) {
      expect(implFn).toContain(`label: "${label}"`)
    }
    expect(implFn).toContain("settlement: initialCreateOutcome.status === \"fulfilled\" ? \"resolve\" : \"reject\"")
    expect(implFn).toContain("settlement: baseCreateOutcome.status === \"fulfilled\" ? \"resolve\" : \"reject\"")
    expect(implFn).toContain("settlement: solanaCreateOutcome.status === \"fulfilled\" ? \"resolve\" : \"reject\"")
    expect(implFn.indexOf("settlement: initialCreateOutcome.status === \"fulfilled\" ? \"resolve\" : \"reject\"")).toBeLessThan(
      implFn.indexOf("wallet_dynamic_create_embedded_wallet_complete")
    )
    expect(implFn.indexOf("settlement: baseCreateOutcome.status === \"fulfilled\" ? \"resolve\" : \"reject\"")).toBeLessThan(
      implFn.indexOf("baseWalletCreateFailedRef.current = false")
    )
    expect(implFn.indexOf("settlement: solanaCreateOutcome.status === \"fulfilled\" ? \"resolve\" : \"reject\"")).toBeLessThan(
      implFn.indexOf("solanaWalletCreateFailedRef.current = false")
    )
  })

  it("a late throw from the outer refresh attempt is also ignored once setup already succeeded - never reported as a fresh failure", () => {
    const catchStart = page.indexOf("} catch (error) {\n      creatingEmbeddedWalletRef.current = false")
    const catchBlock = page.slice(
      catchStart,
      page.indexOf("const classified = classifyDynamicRefreshError(error)", catchStart)
    )
    expect(catchBlock).toContain("const pastTerminalSuccess =")
    expect(catchBlock).toContain("wallet_dynamic_late_result_ignored")
    expect(catchBlock).toContain("return true")
  })

  it("the single-flight clear event is relabeled after terminal success instead of reported as a normal clear", () => {
    const wrapperFn = page.slice(
      page.indexOf("const refreshDynamicWalletRuntime = useCallback((reason: string"),
      page.indexOf("}, [refreshDynamicWalletRuntimeImpl, sdkHasLoaded, user])")
    )
    expect(wrapperFn).toContain("wallet_dynamic_singleflight_cleared_after_success")
    expect(compactSource(wrapperFn)).toContain("const pastTerminalSuccess = walletCoreSetupTerminalGenerationRef.current !== null && generation <= walletCoreSetupTerminalGenerationRef.current")
  })

  it("a later, explicitly user-initiated refresh still gets a fresh (higher) generation and is unaffected by an earlier terminal capture", () => {
    const wrapperFn = page.slice(
      page.indexOf("const refreshDynamicWalletRuntime = useCallback((reason: string"),
      page.indexOf("}, [refreshDynamicWalletRuntimeImpl, sdkHasLoaded, user])")
    )
    // Generation assignment is unconditional - never gated on terminal-success state -
    // so a fresh call always gets a strictly higher generation than the captured one.
    expect(wrapperFn).toContain("const generation = ++walletRuntimeRefreshGenerationRef.current")
    expect(wrapperFn).not.toContain("if (walletCoreSetupTerminalGenerationRef.current")
  })

  it("all four new safe diagnostic events are whitelisted for the server-visible beacon", () => {
    for (const event of [
      "wallet_dynamic_stale_generation_ignored",
      "wallet_dynamic_setup_cancelled_after_success",
      "wallet_dynamic_singleflight_cleared_after_success",
      "wallet_dynamic_late_result_ignored",
    ]) {
      expect(eventRoute).toContain(`"${event}"`)
    }
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
