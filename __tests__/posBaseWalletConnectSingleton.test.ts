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

function createFakeWcProvider() {
  const listeners = new Map<string, Set<FakeListener>>()
  let pairingCounter = 0

  const fake = {
    accounts: [] as string[],
    connected: false,
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
      fake.emit("display_uri", `wc:pairing-${pairingCounter}`)
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    request: vi.fn(),
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
