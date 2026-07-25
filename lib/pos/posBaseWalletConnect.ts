/**
 * POS-owned WalletConnect session helper for Base V7 payments.
 *
 * The POS terminal creates and owns the WC session so that all provider.request()
 * calls are made from the stable POS device. The resulting pairing URI is public
 * (Curve25519 public key + relay info only — the symmetric session key is derived
 * locally via ECDH on both sides and never transmitted) and is shared with the
 * hosted checkout purely so the customer can deep-link into their wallet.
 *
 * Dynamic import keeps the heavy WC bundle out of any server path.
 *
 * Provider lifecycle: a POS terminal handles many sequential sales in a
 * single browser tab lifetime. EthereumProvider.init() (and the WalletConnect
 * Core it creates internally) is meant to be a per-tab singleton — calling it
 * fresh for every payment is what produced the SDK's own "Core is already
 * initialized. Init() was called N times." warning, plus "No matching key" /
 * "Pending session not found" noise from a previous, now-abandoned Core
 * instance's leftover pairing/session storage. Establishing the relay
 * WebSocket connection this performs is also the dominant cost of the
 * multi-second "Preparing secure WalletConnect session…" delay customers saw
 * on every single sale. initPosBaseWalletConnect() now initializes the
 * provider once per tab and reuses it for every subsequent payment — each
 * call still performs a fresh connect() (a new pairing/session), it just no
 * longer pays for a new Core/relay handshake each time.
 *
 * Generation ownership (added after the singleton change above): the shared
 * EthereumProvider instance only ever tracks ONE session/pairing internally
 * — it has no concept of "attempt A's session" vs "attempt B's session".
 * Before this fix, every caller's disconnect() unconditionally tore down
 * whatever the shared provider's *current* session/pairing was — which,
 * once the provider became shared, was sometimes a newer attempt's
 * still-pending proposal rather than the stale caller's own (abandoned)
 * one. That produced exactly the "No matching key" / "Pending session not
 * found" / 13-14s recovery symptom: a later attempt's proposal got deleted
 * out from under it by an earlier attempt's delayed cleanup, and the wallet
 * response that eventually arrived had nothing to correlate against until
 * the SDK's own recovery/retry path (slow) kicked in. `currentGeneration`
 * tracks which connect() cycle currently owns the shared provider's
 * session/pairing state; a PosWcProvider's disconnect() is a safe no-op
 * once a newer generation has taken over.
 */

const BASE_CHAIN_ID = 8453

export type PosWcRequestArgs = {
  method: string
  params?: unknown[]
}

export type PosWcProvider = {
  /** Connected wallet addresses (populated after connect event) */
  accounts: string[]
  /** Send a JSON-RPC request through the WC session */
  request<T = unknown>(args: PosWcRequestArgs): Promise<T>
  /** Tear down the WC session — safe no-op if this attempt has been superseded */
  disconnect(): Promise<void>
  /** Raw provider for advanced use */
  _provider: import("@walletconnect/ethereum-provider").default
}

type PosWcInitResult =
  | { ok: true; provider: PosWcProvider; pairingUri: string }
  | { ok: false; error: string }

type RawWcProvider = import("@walletconnect/ethereum-provider").default

// Shared across every payment attempt in this browser tab — see the module
// doc comment above. Never reset between payments; only cleared if init
// itself fails, so a transient failure can be retried on the next attempt
// instead of permanently wedging the terminal.
let sharedProviderPromise: Promise<RawWcProvider> | null = null

// See "Generation ownership" in the module doc comment above. Only ever
// incremented, never reset — each increment marks a new connect() cycle as
// the sole legitimate owner of the shared provider's session/pairing state.
let currentGeneration = 0

async function getSharedPosWcProvider(): Promise<RawWcProvider> {
  if (sharedProviderPromise) return sharedProviderPromise

  sharedProviderPromise = (async () => {
    const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || ""
    if (!projectId) {
      throw new Error("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not configured")
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.pinetree-payments.com"

    const { default: EthereumProvider } = await import("@walletconnect/ethereum-provider")

    const wcProvider = await EthereumProvider.init({
      projectId,
      chains: [BASE_CHAIN_ID],
      optionalChains: [BASE_CHAIN_ID],
      showQrModal: false,
      methods: [
        "eth_sendTransaction",
        "eth_signTypedData_v4",
        "eth_requestAccounts",
        "eth_accounts",
        "personal_sign",
      ],
      optionalMethods: ["wallet_sendCalls", "wallet_getCapabilities"],
      events: ["accountsChanged", "chainChanged", "disconnect"],
      metadata: {
        name: "PineTree Payments",
        description: "PineTree Payments POS Terminal",
        url: appUrl,
        icons: [],
      },
    })

    // Every payment attempt adds and removes its own one-shot display_uri
    // listener below. Reusing this provider across many sales in a day would
    // otherwise eventually trip the EventEmitter's default max-listener
    // warning even though each listener is correctly removed after use.
    wcProvider.events.setMaxListeners(Number.POSITIVE_INFINITY)

    console.log("[POS WC] provider_singleton_created")
    return wcProvider
  })().catch((err) => {
    // Let the next payment attempt retry init from scratch instead of
    // permanently caching a failed provider.
    sharedProviderPromise = null
    throw err
  })

  return sharedProviderPromise
}

/**
 * Get (initializing once per tab if needed) the shared WalletConnect
 * provider, then start a fresh connect() for this specific payment.
 *
 * Resolves once the pairing URI is available (display_uri event), before the
 * customer connects. The caller should then publish the URI to the API bridge
 * so the hosted checkout can surface deep-link wallet buttons.
 *
 * The returned PosWcProvider stays active until the caller calls disconnect()
 * or the wallet disconnects — disconnecting ends this payment's session only;
 * the underlying shared provider/Core is never torn down, so the next
 * payment's call reuses it instead of paying for another relay handshake.
 */
export async function initPosBaseWalletConnect(): Promise<PosWcInitResult> {
  const providerAlreadyCached = sharedProviderPromise !== null
  let wcProvider: RawWcProvider
  try {
    wcProvider = await getSharedPosWcProvider()
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to init WalletConnect provider",
    }
  }
  console.log("[POS WC] provider_ready", { reused: providerAlreadyCached })

  // Claim ownership of the shared provider's session/pairing state before
  // doing anything else. Any earlier attempt's disconnect() call that runs
  // after this point (however delayed) will see it has been superseded and
  // skip, instead of tearing down what we're about to build.
  currentGeneration += 1
  const myGeneration = currentGeneration
  console.log("[POS WC] generation_claimed", { generation: myGeneration })

  // A previous generation may have left a session behind — either because
  // its own disconnect() correctly no-op'd as stale (see below), or because
  // it never got the chance to run cleanup at all. Whatever exists on the
  // shared provider at this exact point cannot be ours (we haven't called
  // connect() yet), so it's always safe to clear before starting our own
  // fresh pairing — this is what guarantees every attempt begins from a
  // clean slate rather than the SDK ambiguously resuming leftover state
  // from an unrelated payment.
  if (wcProvider.session) {
    console.log("[POS WC] stale_session_cleared_before_connect", { generation: myGeneration })
    await wcProvider.disconnect().catch(() => null)
  }

  return new Promise<PosWcInitResult>((resolve) => {
    let resolved = false
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null

    const onDisplayUri = (uri: string) => {
      if (resolved) return
      resolved = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      wcProvider.off("display_uri", onDisplayUri)
      console.log("[POS WC] display_uri_emitted", { generation: myGeneration })

      const posProvider: PosWcProvider = {
        get accounts() {
          return wcProvider.accounts
        },
        async request<T = unknown>(args: PosWcRequestArgs): Promise<T> {
          return wcProvider.request<T>(args as Parameters<typeof wcProvider.request>[0])
        },
        async disconnect() {
          if (currentGeneration !== myGeneration) {
            console.log("[POS WC] disconnect_skipped_stale_generation", {
              generation: myGeneration,
              currentGeneration,
            })
            return
          }
          console.log("[POS WC] disconnect_started", { generation: myGeneration })
          try {
            await wcProvider.disconnect()
          } catch {
            // ignore — session may already be gone
          }
          console.log("[POS WC] disconnect_completed", { generation: myGeneration })
        },
        _provider: wcProvider,
      }

      resolve({ ok: true, provider: posProvider, pairingUri: uri })
    }

    // display_uri fires before the wallet connects, carrying the pairing URI
    wcProvider.on("display_uri", onDisplayUri)

    console.log("[POS WC] connect_called", { generation: myGeneration })
    // Kick off a fresh pairing for this payment (non-blocking — resolves above via event)
    wcProvider.connect().catch((err: unknown) => {
      if (!resolved) {
        resolved = true
        if (timeoutHandle) clearTimeout(timeoutHandle)
        wcProvider.off("display_uri", onDisplayUri)
        resolve({
          ok: false,
          error: err instanceof Error ? err.message : "WalletConnect connect() failed",
        })
      }
    })

    // Safety timeout: if display_uri never fires, fail cleanly
    timeoutHandle = setTimeout(() => {
      if (!resolved) {
        resolved = true
        wcProvider.off("display_uri", onDisplayUri)
        resolve({ ok: false, error: "Timed out waiting for WalletConnect pairing URI" })
      }
    }, 20_000)
  })
}

/**
 * Wait for the wallet to complete the pairing and session handshake.
 * Call this after publishing the pairing URI. Resolves with the connected address.
 *
 * Listens for both "connect" and "accountsChanged" because WalletConnect v2
 * EthereumProvider reliably emits "accountsChanged" with the approved accounts
 * when a session is established. "connect" alone can be missed in some flows.
 */
export function waitForWalletConnect(provider: PosWcProvider): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const wcProvider = provider._provider
    let settled = false

    function settle(address: string) {
      if (settled) return
      settled = true
      wcProvider.off("connect", onConnect)
      wcProvider.off("accountsChanged", onAccountsChanged)
      wcProvider.off("disconnect", onDisconnect)
      resolve(address)
    }

    function fail(err: Error) {
      if (settled) return
      settled = true
      wcProvider.off("connect", onConnect)
      wcProvider.off("accountsChanged", onAccountsChanged)
      wcProvider.off("disconnect", onDisconnect)
      reject(err)
    }

    function onConnect() {
      settle(wcProvider.accounts[0] || "")
    }

    function onAccountsChanged(accounts: unknown) {
      const arr = Array.isArray(accounts) ? (accounts as string[]) : []
      if (arr.length > 0) settle(arr[0])
    }

    function onDisconnect() {
      fail(new Error("Wallet disconnected before completing pairing"))
    }

    // If already connected (session resumed), resolve immediately
    if (wcProvider.connected && wcProvider.accounts.length > 0) {
      resolve(wcProvider.accounts[0])
      return
    }

    wcProvider.on("connect", onConnect)
    wcProvider.on("accountsChanged", onAccountsChanged)
    wcProvider.on("disconnect", onDisconnect)

    setTimeout(() => {
      fail(new Error("Timed out waiting for wallet to connect"))
    }, 120_000)
  })
}
