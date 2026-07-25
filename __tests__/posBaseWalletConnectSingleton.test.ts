import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression coverage for the WalletConnect startup-latency fix.
 *
 * Production logs showed "WalletConnect Core is already initialized. Init()
 * was called 2 times." plus "No matching key" / "Pending session not found"
 * noise, and a 3-5s "Preparing secure WalletConnect session..." delay on
 * every single sale. Root cause: lib/pos/posBaseWalletConnect.ts called
 * EthereumProvider.init() (which creates a new WalletConnect Core and
 * establishes a fresh relay WebSocket connection) fresh on every payment
 * attempt, even though a single POS terminal handles many sequential sales
 * in one browser tab lifetime. EthereumProvider.init()/Core are meant to be
 * a per-tab singleton.
 *
 * The fix initializes the provider once per tab (cached in module scope) and
 * reuses it for every subsequent initPosBaseWalletConnect() call — each call
 * still performs its own fresh connect() (a new pairing/session per
 * payment), it just no longer pays for Core re-initialization or a new relay
 * handshake each time.
 */

type FakeListener = (...args: unknown[]) => void

function createFakeWcProvider(opts: { includeStoreDiagnostics?: boolean } = {}) {
  const { includeStoreDiagnostics = true } = opts
  const listeners = new Map<string, Set<FakeListener>>()
  let pairingCounter = 0
  // Simulates the SDK's own internal proposal.set(id, ...) — a fresh id is
  // "stored" the moment connect() emits display_uri, mirroring (a simplified
  // version of) the real Engine.connect() -> sendRequest -> setProposal order.
  let proposalKeys: number[] = []

  const fake = {
    accounts: [] as string[],
    connected: false,
    session: undefined as { topic: string } | undefined,
    events: { setMaxListeners: vi.fn() },
    on(event: string, listener: FakeListener) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(listener)
    },
    off(event: string, listener: FakeListener) {
      listeners.get(event)?.delete(listener)
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    },
    // Real WalletConnect emits display_uri as part of connect()'s own work,
    // before connect() itself resolves — mirror that here instead of
    // relying on the test to guess how many microtask ticks pass before the
    // display_uri listener is registered.
    connect: vi.fn().mockImplementation(async () => {
      pairingCounter += 1
      proposalKeys = [...proposalKeys, 9_000_000 + pairingCounter]
      fake.emit("display_uri", `wc:pairing-${pairingCounter}`)
    }),
    disconnect: vi.fn().mockImplementation(async () => {
      fake.session = undefined
    }),
    request: vi.fn(),
    // Test-only helper: simulate the wallet approving and a session settling.
    _simulateSessionEstablished(topic: string) {
      fake.session = { topic }
    },
    ...(includeStoreDiagnostics
      ? {
          signer: {
            client: {
              core: {
                name: "client",
                context: "client",
                relayer: { connected: true },
                pairing: { pairings: { length: 0 } },
              },
              proposal: {
                get length() {
                  return proposalKeys.length
                },
                get keys() {
                  return [...proposalKeys]
                },
              },
              session: { length: 0 },
            },
          },
        }
      : {}),
  }
  return fake
}

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
}))

vi.mock("@walletconnect/ethereum-provider", () => ({
  default: { init: mocks.init },
}))

describe("initPosBaseWalletConnect — singleton provider reuse", () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.init.mockReset()
    vi.stubEnv("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", "test-project-id")
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.pinetree-payments.com")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("calls EthereumProvider.init() exactly once across two sequential payment attempts", async () => {
    const fakeProvider = createFakeWcProvider()
    mocks.init.mockResolvedValue(fakeProvider)

    const { initPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")

    const first = initPosBaseWalletConnect()
    const firstResult = await first
    expect(firstResult.ok).toBe(true)

    const secondResult = await initPosBaseWalletConnect()
    expect(secondResult.ok).toBe(true)

    expect(mocks.init).toHaveBeenCalledTimes(1)
  })

  it("still generates a fresh pairing (a new connect() call and a new pairing URI) for every payment attempt", async () => {
    const fakeProvider = createFakeWcProvider()
    mocks.init.mockResolvedValue(fakeProvider)

    const { initPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")

    const firstResult = await initPosBaseWalletConnect()
    const secondResult = await initPosBaseWalletConnect()

    expect(fakeProvider.connect).toHaveBeenCalledTimes(2)
    expect(firstResult.ok && firstResult.pairingUri).toBe("wc:pairing-1")
    expect(secondResult.ok && secondResult.pairingUri).toBe("wc:pairing-2")
  })

  it("raises the shared provider's max listener count once, not once per payment attempt", async () => {
    const fakeProvider = createFakeWcProvider()
    mocks.init.mockResolvedValue(fakeProvider)

    const { initPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")

    for (let i = 0; i < 3; i++) {
      await initPosBaseWalletConnect()
    }

    expect(fakeProvider.events.setMaxListeners).toHaveBeenCalledTimes(1)
  })

  it("does not leave a permanently-failed cached provider — a later attempt can retry init after an earlier failure", async () => {
    mocks.init.mockRejectedValueOnce(new Error("relay unreachable"))

    const { initPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")

    const failedResult = await initPosBaseWalletConnect()
    expect(failedResult.ok).toBe(false)

    const fakeProvider = createFakeWcProvider()
    mocks.init.mockResolvedValueOnce(fakeProvider)

    const retryResult = await initPosBaseWalletConnect()

    expect(retryResult.ok).toBe(true)
    expect(mocks.init).toHaveBeenCalledTimes(2)
  })

  it("returns ok:false without ever calling EthereumProvider.init() when the project ID is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", "")

    const { initPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")
    const result = await initPosBaseWalletConnect()

    expect(result.ok).toBe(false)
    expect(mocks.init).not.toHaveBeenCalled()
  })
})

/**
 * Regression coverage for the production symptom that appeared *after* the
 * singleton fix above: "No matching key. proposal: ...", "Pending session
 * not found for topic ...", and a 13-14s recovery delay before
 * wallet_connected, on attemptId 4 in the same tab. Root cause: the shared
 * provider only tracks one session/pairing internally, but every attempt's
 * disconnect() call unconditionally tore down whatever the shared
 * provider's *current* state was — including a newer, still-pending
 * attempt's proposal, if an older attempt's cleanup ran late. A previous
 * attempt may only clean up resources it still owns.
 */
describe("initPosBaseWalletConnect — generation ownership across sequential attempts", () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.init.mockReset()
    vi.stubEnv("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", "test-project-id")
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.pinetree-payments.com")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("attempt 1 completes, then attempt 2 starts — attempt 1's own disconnect() still tears down its own session normally", async () => {
    const fakeProvider = createFakeWcProvider()
    mocks.init.mockResolvedValue(fakeProvider)

    const { initPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")

    const attempt1 = await initPosBaseWalletConnect()
    expect(attempt1.ok).toBe(true)
    if (!attempt1.ok) return
    fakeProvider._simulateSessionEstablished("topic-1")

    // Attempt 1 finishes normally (payment completed) and cleans up before
    // attempt 2 ever starts — the ordinary sequential case.
    await attempt1.provider.disconnect()
    expect(fakeProvider.disconnect).toHaveBeenCalledTimes(1)
    expect(fakeProvider.session).toBeUndefined()

    const attempt2 = await initPosBaseWalletConnect()
    expect(attempt2.ok).toBe(true)
    // No extra stale-session cleanup needed — attempt 1 already cleaned up.
    expect(fakeProvider.disconnect).toHaveBeenCalledTimes(1)
  })

  it("attempt 1 is canceled (its disconnect() call is delayed), then attempt 2 starts — attempt 1's late disconnect() must not touch attempt 2's proposal", async () => {
    const fakeProvider = createFakeWcProvider()
    mocks.init.mockResolvedValue(fakeProvider)

    const { initPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")

    const attempt1 = await initPosBaseWalletConnect()
    expect(attempt1.ok).toBe(true)
    if (!attempt1.ok) return

    // Attempt 2 starts BEFORE attempt 1's cleanup has run (e.g. attempt 1's
    // runPosBaseFlow finally block is still in flight when a new intent
    // supersedes it and starts its own flow).
    const attempt2 = await initPosBaseWalletConnect()
    expect(attempt2.ok).toBe(true)
    if (!attempt2.ok) return
    fakeProvider._simulateSessionEstablished("topic-2")

    // Attempt 1's cleanup finally runs, late.
    await attempt1.provider.disconnect()

    // It must be a no-op: attempt 2's live session must survive untouched.
    expect(fakeProvider.disconnect).not.toHaveBeenCalled()
    expect(fakeProvider.session).toEqual({ topic: "topic-2" })
  })

  it("attempt 1's cleanup cannot remove attempt 2's proposal state even when both disconnect() calls race", async () => {
    const fakeProvider = createFakeWcProvider()
    mocks.init.mockResolvedValue(fakeProvider)

    const { initPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")

    const attempt1 = await initPosBaseWalletConnect()
    const attempt2 = await initPosBaseWalletConnect()
    if (!attempt1.ok || !attempt2.ok) throw new Error("setup failed")
    fakeProvider._simulateSessionEstablished("topic-2")

    // Both attempts' cleanup fire in the same tick, attempt 1 first.
    await Promise.all([attempt1.provider.disconnect(), attempt2.provider.disconnect()])

    // Only attempt 2 (the current generation) was allowed to actually
    // disconnect the shared provider.
    expect(fakeProvider.disconnect).toHaveBeenCalledTimes(1)
  })

  it("a completed/abandoned session left behind by a superseded attempt does not leak into the next payment — it is cleared before the new connect()", async () => {
    const fakeProvider = createFakeWcProvider()
    mocks.init.mockResolvedValue(fakeProvider)

    const { initPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")

    const attempt1 = await initPosBaseWalletConnect()
    if (!attempt1.ok) throw new Error("setup failed")
    // Attempt 1 got a real session, but its own cleanup never ran (e.g. the
    // tab was mid-navigation, or the code path that calls disconnect()
    // threw before reaching it).
    fakeProvider._simulateSessionEstablished("topic-1")

    const attempt2 = await initPosBaseWalletConnect()

    expect(attempt2.ok).toBe(true)
    // initPosBaseWalletConnect itself cleared the leftover session before
    // starting attempt 2's own connect() — this is the safety net that
    // guarantees no attempt ever ambiguously resumes unrelated state.
    expect(fakeProvider.disconnect).toHaveBeenCalledTimes(1)
  })

  it("every attempt still receives its own fresh pairing URI even across generation handoffs", async () => {
    const fakeProvider = createFakeWcProvider()
    mocks.init.mockResolvedValue(fakeProvider)

    const { initPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")

    const attempt1 = await initPosBaseWalletConnect()
    fakeProvider._simulateSessionEstablished("topic-1")
    const attempt2 = await initPosBaseWalletConnect()

    expect(attempt1.ok && attempt1.pairingUri).toBe("wc:pairing-1")
    expect(attempt2.ok && attempt2.pairingUri).toBe("wc:pairing-2")
  })

  it("the provider singleton is never re-initialized across this whole sequence", async () => {
    const fakeProvider = createFakeWcProvider()
    mocks.init.mockResolvedValue(fakeProvider)

    const { initPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")

    for (let i = 0; i < 4; i++) {
      const attempt = await initPosBaseWalletConnect()
      if (attempt.ok) fakeProvider._simulateSessionEstablished(`topic-${i}`)
    }

    expect(mocks.init).toHaveBeenCalledTimes(1)
  })
})

/**
 * Regression coverage for prewarming the shared WalletConnect provider on
 * POS page mount, well before any customer selects Base — moving the Core
 * init + relay handshake cost off the critical path of the first sale.
 * prewarmPosBaseWalletConnect() must create no pairing/proposal/session
 * (it never calls connect()) and must share the exact same dedup + retry
 * semantics as the real payment path.
 */
describe("prewarmPosBaseWalletConnect", () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.init.mockReset()
    vi.stubEnv("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", "test-project-id")
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.pinetree-payments.com")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("initializes the provider without ever calling connect() — no pairing, proposal, or session is created", async () => {
    const fakeProvider = createFakeWcProvider()
    mocks.init.mockResolvedValue(fakeProvider)

    const { prewarmPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")
    await prewarmPosBaseWalletConnect()

    expect(mocks.init).toHaveBeenCalledTimes(1)
    expect(fakeProvider.connect).not.toHaveBeenCalled()
  })

  it("a real payment attempt after prewarm reuses the already-initialized provider — no second EthereumProvider.init() call", async () => {
    const fakeProvider = createFakeWcProvider()
    mocks.init.mockResolvedValue(fakeProvider)

    const { prewarmPosBaseWalletConnect, initPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")
    await prewarmPosBaseWalletConnect()
    const result = await initPosBaseWalletConnect()

    expect(mocks.init).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    expect(fakeProvider.connect).toHaveBeenCalledTimes(1)
  })

  it("concurrent prewarm and payment-start calls share one initialization promise, not two", async () => {
    const fakeProvider = createFakeWcProvider()
    mocks.init.mockResolvedValue(fakeProvider)

    const { prewarmPosBaseWalletConnect, initPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")
    const [, paymentResult] = await Promise.all([
      prewarmPosBaseWalletConnect(),
      initPosBaseWalletConnect(),
    ])

    expect(mocks.init).toHaveBeenCalledTimes(1)
    expect(paymentResult.ok).toBe(true)
  })

  it("never throws even if EthereumProvider.init() fails", async () => {
    mocks.init.mockRejectedValueOnce(new Error("relay unreachable"))

    const { prewarmPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")
    await expect(prewarmPosBaseWalletConnect()).resolves.toBeUndefined()
  })

  it("a failed prewarm does not block a later payment attempt from retrying init", async () => {
    mocks.init.mockRejectedValueOnce(new Error("relay unreachable"))

    const { prewarmPosBaseWalletConnect, initPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")
    await prewarmPosBaseWalletConnect()

    const fakeProvider = createFakeWcProvider()
    mocks.init.mockResolvedValueOnce(fakeProvider)
    const result = await initPosBaseWalletConnect()

    expect(result.ok).toBe(true)
    expect(mocks.init).toHaveBeenCalledTimes(2)
  })

  it("calling prewarm multiple times (e.g. mount + a later defensive call) only initializes once", async () => {
    const fakeProvider = createFakeWcProvider()
    mocks.init.mockResolvedValue(fakeProvider)

    const { prewarmPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")
    await prewarmPosBaseWalletConnect()
    await prewarmPosBaseWalletConnect()
    await prewarmPosBaseWalletConnect()

    expect(mocks.init).toHaveBeenCalledTimes(1)
  })
})

/**
 * Regression coverage for the "No matching key. proposal" / "Pending session
 * not found for topic" production incident that occurred with NO disconnect
 * of any kind in the window before it — ruling out the generation-ownership
 * hazard covered above. Source audit of the installed WalletConnect SDK
 * traced both error strings to the generic Store's NO_MATCHING_KEY lookup
 * failure and a linear pendingSessions search inside Engine.ts, and found
 * that this POS page (app/dashboard/pos) is nested inside the same
 * app/dashboard/layout.tsx that mounts PineTreeDynamicProvider — Dynamic
 * Labs' SDK, which bundles its own, differently-versioned WalletConnect Core
 * instances. Neither side customized WalletConnect's default storage
 * naming, so both would persist proposal/session/keychain state under
 * identical storage keys on the same origin. customStoragePrefix gives this
 * Core a private namespace, closing off that hazard regardless of what any
 * other WalletConnect Core on the page does.
 */
describe("initPosBaseWalletConnect — WalletConnect Core storage isolation", () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.init.mockReset()
    vi.stubEnv("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", "test-project-id")
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.pinetree-payments.com")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("passes a customStoragePrefix to EthereumProvider.init() that is not the SDK's shared default, so this Core never reads/writes the same storage keys as any other WalletConnect Core on the origin (e.g. Dynamic Labs' connectors)", async () => {
    const fakeProvider = createFakeWcProvider()
    mocks.init.mockResolvedValue(fakeProvider)

    const { initPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")
    await initPosBaseWalletConnect()

    expect(mocks.init).toHaveBeenCalledTimes(1)
    const initOpts = mocks.init.mock.calls[0][0]
    expect(typeof initOpts.customStoragePrefix).toBe("string")
    expect(initOpts.customStoragePrefix.length).toBeGreaterThan(0)
    // "wc@2" is the SDK's own default customStoragePrefix — using it here
    // would recreate exactly the shared-storage hazard this fix closes off.
    expect(initOpts.customStoragePrefix).not.toBe("wc@2")
  })

  it("uses the same customStoragePrefix across every payment attempt in the tab (the singleton is only constructed once)", async () => {
    const fakeProvider = createFakeWcProvider()
    mocks.init.mockResolvedValue(fakeProvider)

    const { initPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")
    await initPosBaseWalletConnect()
    fakeProvider._simulateSessionEstablished("topic-1")
    await initPosBaseWalletConnect()

    expect(mocks.init).toHaveBeenCalledTimes(1)
  })
})

/**
 * Regression coverage for the safe, production-facing SDK-store diagnostics
 * added to help root-cause any future recurrence of the incident above. Logs
 * proposal/session/pairing store *counts* (and, distinctly, a numeric
 * proposal id — never a topic, URI, key, address, or payload) at the
 * lifecycle points needed to tell "never stored" apart from "stored, then
 * vanished." Must degrade to a harmless no-op if the SDK's internal store
 * surface isn't present or throws — this instrumentation must never be able
 * to break a real payment.
 */
describe("initPosBaseWalletConnect / waitForWalletConnect — SDK store diagnostics", () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    mocks.init.mockReset()
    vi.stubEnv("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", "test-project-id")
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.pinetree-payments.com")
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    logSpy.mockRestore()
  })

  function storeSnapshotCalls(stage: string) {
    return logSpy.mock.calls.filter((call) => call[0] === "[POS WC][store]" && call[1] === stage)
  }

  it("logs the proposal-store count before connect() and again once display_uri fires, and identifies the newly created proposal id by diffing store keys", async () => {
    const fakeProvider = createFakeWcProvider()
    mocks.init.mockResolvedValue(fakeProvider)

    const { initPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")
    await initPosBaseWalletConnect()

    const beforeCalls = storeSnapshotCalls("before_connect")
    const afterCalls = storeSnapshotCalls("display_uri_emitted")
    expect(beforeCalls).toHaveLength(1)
    expect(afterCalls).toHaveLength(1)
    expect(beforeCalls[0][2]).toMatchObject({ proposalStoreCount: 0 })
    expect(afterCalls[0][2]).toMatchObject({ proposalStoreCount: 1, newProposalId: 9_000_001 })
  })

  it("gives every sequential payment attempt its own newly-diffed proposal id, never reusing a prior attempt's", async () => {
    const fakeProvider = createFakeWcProvider()
    mocks.init.mockResolvedValue(fakeProvider)

    const { initPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")
    await initPosBaseWalletConnect()
    fakeProvider._simulateSessionEstablished("topic-1")
    await initPosBaseWalletConnect()

    const afterCalls = storeSnapshotCalls("display_uri_emitted")
    expect(afterCalls).toHaveLength(2)
    expect(afterCalls[0][2]).toMatchObject({ newProposalId: 9_000_001 })
    expect(afterCalls[1][2]).toMatchObject({ newProposalId: 9_000_002 })
  })

  it("logs a final snapshot when the wallet connects and stops ticking afterward (no periodic-snapshot leak past resolution)", async () => {
    vi.useFakeTimers()
    try {
      const fakeProvider = createFakeWcProvider()
      mocks.init.mockResolvedValue(fakeProvider)

      const { initPosBaseWalletConnect, waitForWalletConnect } = await import(
        "@/lib/pos/posBaseWalletConnect"
      )
      const initResult = await initPosBaseWalletConnect()
      if (!initResult.ok) throw new Error("setup failed")

      const waitPromise = waitForWalletConnect(initResult.provider)
      await vi.advanceTimersByTimeAsync(3_000)
      expect(storeSnapshotCalls("waiting_for_wallet_tick").length).toBeGreaterThanOrEqual(1)

      fakeProvider.accounts = ["0xabc"]
      fakeProvider.emit("accountsChanged", ["0xabc"])
      await waitPromise

      expect(storeSnapshotCalls("wallet_connected")).toHaveLength(1)
      const tickCountAtResolve = storeSnapshotCalls("waiting_for_wallet_tick").length

      // Advance well past another would-be tick — if the interval weren't
      // cleared on resolve, this would log more ticks after the promise
      // already settled.
      await vi.advanceTimersByTimeAsync(10_000)
      expect(storeSnapshotCalls("waiting_for_wallet_tick").length).toBe(tickCountAtResolve)
    } finally {
      vi.useRealTimers()
    }
  })

  it("never throws and still completes the payment flow when the SDK's internal store surface is entirely absent", async () => {
    const fakeProvider = createFakeWcProvider({ includeStoreDiagnostics: false })
    mocks.init.mockResolvedValue(fakeProvider)

    const { initPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")
    const result = await initPosBaseWalletConnect()

    expect(result.ok).toBe(true)
  })

  it("never throws and still completes the payment flow when reading the SDK's internal store surface itself throws", async () => {
    const fakeProvider = createFakeWcProvider()
    Object.defineProperty(fakeProvider.signer!.client, "proposal", {
      get() {
        throw new Error("simulated internal SDK read failure")
      },
    })
    mocks.init.mockResolvedValue(fakeProvider)

    const { initPosBaseWalletConnect } = await import("@/lib/pos/posBaseWalletConnect")
    const result = await initPosBaseWalletConnect()

    expect(result.ok).toBe(true)
  })
})
