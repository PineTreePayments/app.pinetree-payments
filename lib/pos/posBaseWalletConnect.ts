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
 *
 * Storage isolation (added after a production trace showed "No matching
 * key. proposal" / "Pending session not found for topic" with NO disconnect
 * of any kind in the window before them — ruling out the generation-ownership
 * hazard above for that incident): this page (POS terminal, under
 * app/dashboard/pos) is nested inside app/dashboard/layout.tsx, which also
 * mounts PineTreeDynamicProvider — Dynamic Labs' own SDK, which bundles its
 * OWN independent WalletConnect Core instances for its Ethereum and Solana
 * connectors (verified in node_modules: different @walletconnect/* versions
 * entirely from the ones this file uses). Neither this wrapper's
 * EthereumProvider.init() call nor Dynamic's connector customizes WalletConnect
 * Core's storage naming, so both would default to the SAME
 * customStoragePrefix ("wc@2") and store name ("client") on the same origin —
 * exactly the anti-pattern WalletConnect's own docs warn against ("avoid
 * multiple Core instances on one page"), since every persisted
 * keychain/proposal/session row in IndexedDB/localStorage is written and
 * read under identical keys by two unrelated SignClient instances. This does
 * not by itself explain every symptom in the incident (see the audit report
 * for the parts that could not be confirmed without a live relay), but it is
 * a real, fully-avoidable hazard: POS_WC_STORAGE_PREFIX below gives this
 * Core its own private storage namespace, verified supported by the
 * installed SDK (EthereumProvider.initialize() forwards
 * `customStoragePrefix` through to UniversalProvider.init() -> SignClient ->
 * Core unchanged).
 *
 * Diagnostic instrumentation (logWcStoreSnapshot below): development/production
 * -safe logging of proposal/session/pairing store *counts* (never topics, URIs,
 * keys, addresses, or payloads) at the key lifecycle points a future incident
 * would need to distinguish "the proposal was never stored" from "it was
 * stored, then disappeared" from "a different Core instance answered." Reads
 * only the public Store surface (IStore.length) — never private engine
 * internals — so it cannot break on an unrelated SDK patch update.
 */

import { markBaseCheckoutLatency } from "@/lib/payment/baseCheckoutLatencyTrace"

const BASE_CHAIN_ID = 8453

// Unique to this app's POS WalletConnect Core — never shared with any other
// WalletConnect/Reown Core that might exist elsewhere on the same origin
// (e.g. Dynamic Labs' own connectors, mounted app-wide via
// PineTreeDynamicProvider). See module doc comment above.
const POS_WC_STORAGE_PREFIX = "pinetree-pos-wc@2"

type WcDiagnosticProvider = {
  signer?: {
    client?: {
      core?: {
        name?: string
        context?: string
        relayer?: { connected?: boolean }
        pairing?: { pairings?: { length?: number } }
      }
      proposal?: { length?: number; keys?: number[] }
      session?: { length?: number }
    }
  }
}

// Short random token identifying this tab's singleton Core instance across
// every diagnostic log line, so separate log lines can be correlated back to
// "the same live object" without needing to log anything sensitive.
let coreInstanceId: string | null = null

function generateCoreInstanceId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * Safe, best-effort snapshot of the WalletConnect SDK's own internal store
 * state — counts only, never topics/URIs/keys/addresses/payloads. Every
 * field is read defensively: this must never throw or block the payment
 * flow, since it reaches into semi-internal (public-but-not-guaranteed)
 * SDK surface that could legitimately be absent depending on SDK version
 * or connection state.
 */
function logWcStoreSnapshot(
  stage: string,
  wcProvider: WcDiagnosticProvider,
  extra: Record<string, unknown> = {}
): void {
  try {
    const client = wcProvider.signer?.client
    console.log("[POS WC][store]", stage, {
      coreInstanceId,
      coreName: client?.core?.name,
      coreContext: client?.core?.context,
      relayerConnected: client?.core?.relayer?.connected,
      proposalStoreCount: client?.proposal?.length,
      sessionStoreCount: client?.session?.length,
      pairingStoreCount: client?.core?.pairing?.pairings?.length,
      ...extra,
    })
  } catch (err) {
    console.warn("[POS WC][store] snapshot_failed", {
      stage,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Same defensive-read guarantee as logWcStoreSnapshot, for the proposal-id diff below. */
function safeProposalKeys(wcProvider: WcDiagnosticProvider): number[] {
  try {
    return wcProvider.signer?.client?.proposal?.keys ?? []
  } catch {
    return []
  }
}

type WcRelayerControl = {
  connected?: boolean
  transportOpen?: () => Promise<void>
  on?: (event: string, listener: () => void) => void
  off?: (event: string, listener: () => void) => void
}

function getRelayerControl(wcProvider: WcDiagnosticProvider): WcRelayerControl | undefined {
  try {
    return wcProvider.signer?.client?.core?.relayer as WcRelayerControl | undefined
  } catch {
    return undefined
  }
}

// Guards against attaching relayer_connect/relayer_disconnect listeners more
// than once across repeated prewarm calls (mount + a later defensive call
// both hit this) — the shared Core/relayer only ever needs one set.
let relayerLifecycleLoggingAttached = false
let relayerDisconnectedAt: number | null = null

/**
 * Verified against the installed SDK's own source (@walletconnect/core):
 * Relayer.init() (run once, automatically, inside Core.start()) already
 * fire-and-forgets a transportOpen() call — but transportOpen() itself
 * unconditionally no-ops ("Starting WS connection skipped because the
 * client has no topics to work with.") whenever subscriber.hasAnyTopics is
 * false, which is guaranteed true for a freshly-constructed Core with no
 * persisted pairing/session. The only thing that flips hasAnyTopics is a
 * real subscribe() call for an actual topic — which today only happens
 * inside connect()'s pairing.create(). There is no other publicly typed,
 * documented hook to force the relay socket open before a topic exists.
 * Calling connect()/pairing.create() during prewarm is explicitly out of
 * scope (it would create a pairing URI), and reaching past Relayer into its
 * raw internal transport (bypassing this gate) would rely on undocumented,
 * untyped internals — not "verified supported."
 *
 * So this call cannot warm the relay ahead of the very first cold
 * connect() in a tab — that gate is a deliberate SDK design choice, not a
 * PineTree bug. What it DOES do, verifiably: (1) it is the same
 * already-public, documented, idempotent Relayer.transportOpen() call the
 * SDK itself performs automatically, so calling it again here is safe and
 * side-effect-free when it no-ops; (2) once this tab's Core has ever
 * subscribed to any topic (i.e. after the first payment's connect()),
 * hasAnyTopics stays true for the rest of the tab's life, so calling this
 * again on every later prewarm (POS mount is only once per tab, but this
 * export is safe to call repeatedly) gives every payment *after* the first
 * a real chance to reuse an already-open — or freshly reopened — socket
 * instead of paying a relay handshake mid-connect().
 */
async function attemptRelayerPrewarm(wcProvider: RawWcProvider): Promise<void> {
  const diagProvider = wcProvider as unknown as WcDiagnosticProvider
  const relayer = getRelayerControl(diagProvider)
  if (!relayer) return

  if (!relayerLifecycleLoggingAttached && relayer.on) {
    relayerLifecycleLoggingAttached = true
    relayer.on("relayer_connect", () => {
      const durationMs = relayerDisconnectedAt ? Date.now() - relayerDisconnectedAt : null
      relayerDisconnectedAt = null
      console.log("[POS WC][relay] prewarm_relayer_connected", {
        coreInstanceId,
        reconnectDurationMs: durationMs,
      })
    })
    relayer.on("relayer_disconnect", () => {
      relayerDisconnectedAt = Date.now()
      console.log("[POS WC][relay] prewarm_relayer_closed", { coreInstanceId })
    })
  }

  if (relayer.connected) {
    console.log("[POS WC][relay] prewarm_relayer_connect_started", {
      coreInstanceId,
      alreadyConnected: true,
    })
    return
  }

  console.log("[POS WC][relay] prewarm_relayer_connect_started", {
    coreInstanceId,
    alreadyConnected: false,
  })
  try {
    await relayer.transportOpen?.()
    console.log("[POS WC][relay] prewarm_relayer_transport_open_call_completed", {
      coreInstanceId,
      connected: relayer.connected,
    })
  } catch (err) {
    // transportOpen() throws if a real connection attempt (topics existed)
    // failed — never let a relay-warming failure block the terminal from
    // starting a real payment later; the real connect() will simply pay for
    // its own handshake as before.
    console.warn("[POS WC][relay] prewarm_relayer_connect_failed", {
      coreInstanceId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

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
  /** The generation this provider claimed ownership under — see currentGeneration below. */
  generation: number
}

type PosWcInitResult =
  | { ok: true; provider: PosWcProvider; pairingUri: string }
  | { ok: false; error: string }

/**
 * True if `generation` still owns the shared provider's session/pairing
 * state. Lets a long-running wallet request (signature, transaction) verify
 * — at any await boundary, without needing to call disconnect() — that a
 * newer attempt hasn't since claimed the shared WalletConnect session out
 * from under it before acting on whatever the request resolves with.
 */
export function isPosWcGenerationCurrent(generation: number): boolean {
  return currentGeneration === generation
}

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
      customStoragePrefix: POS_WC_STORAGE_PREFIX,
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

    coreInstanceId = generateCoreInstanceId()
    console.log("[POS WC] provider_singleton_created", { coreInstanceId })
    console.log("[POS WC][relay] prewarm_core_initialized", { coreInstanceId })
    logWcStoreSnapshot("provider_singleton_created", wcProvider)
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
 * Warm the shared WalletConnect provider/Core (and its relay connection)
 * before any payment begins — e.g. on POS page mount. This does exactly
 * what getSharedPosWcProvider() above already does for the first real
 * payment (dedup'd, retryable on failure) — calling this early just moves
 * that cost off the critical path of the customer's first Base selection.
 * It creates no pairing URI, no proposal, and no wallet connection: nothing
 * here calls connect(). Safe to call multiple times (e.g. once on mount and
 * again defensively later) — concurrent/repeated callers share one
 * initialization.
 */
export async function prewarmPosBaseWalletConnect(): Promise<void> {
  console.log("[POS WC][relay] prewarm_started")
  try {
    const wcProvider = await getSharedPosWcProvider()
    console.log("[POS WC] provider_prewarmed")
    await attemptRelayerPrewarm(wcProvider)
  } catch (err) {
    console.warn("[POS WC] provider_prewarm_failed", {
      error: err instanceof Error ? err.message : String(err),
    })
  }
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
  markBaseCheckoutLatency("walletconnect_provider_ready", { reused: providerAlreadyCached })

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

    const diagProvider = wcProvider as unknown as WcDiagnosticProvider
    const proposalKeysBeforeConnect = new Set(safeProposalKeys(diagProvider))

    const onDisplayUri = (uri: string) => {
      if (resolved) return
      resolved = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      wcProvider.off("display_uri", onDisplayUri)
      console.log("[POS WC] display_uri_emitted", { generation: myGeneration })
      const newProposalKeys = safeProposalKeys(diagProvider).filter(
        (key) => !proposalKeysBeforeConnect.has(key)
      )
      logWcStoreSnapshot("display_uri_emitted", diagProvider, {
        generation: myGeneration,
        newProposalId: newProposalKeys[0],
      })

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
        generation: myGeneration,
      }

      resolve({ ok: true, provider: posProvider, pairingUri: uri })
    }

    // display_uri fires before the wallet connects, carrying the pairing URI
    wcProvider.on("display_uri", onDisplayUri)

    console.log("[POS WC] connect_called", { generation: myGeneration })
    markBaseCheckoutLatency("connect_called", { generation: myGeneration })
    logWcStoreSnapshot("before_connect", diagProvider, { generation: myGeneration })
    console.log("[POS WC][relay] before_payment_relayer_connected", {
      coreInstanceId,
      generation: myGeneration,
      connected: getRelayerControl(diagProvider)?.connected ?? null,
    })
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
    const diagProvider = wcProvider as unknown as WcDiagnosticProvider
    let settled = false

    // Periodic store snapshot while waiting on the wallet's (human-speed,
    // sometimes 10+ second) approval — this is the window the production
    // incident's "No matching key" / "Pending session not found" errors
    // occurred in. Ticking here gives a before/after trail across that
    // window without hooking any private SDK internals.
    const snapshotInterval = setInterval(() => {
      logWcStoreSnapshot("waiting_for_wallet_tick", diagProvider)
    }, 3_000)

    function settle(address: string) {
      if (settled) return
      settled = true
      clearInterval(snapshotInterval)
      wcProvider.off("connect", onConnect)
      wcProvider.off("accountsChanged", onAccountsChanged)
      wcProvider.off("disconnect", onDisconnect)
      logWcStoreSnapshot("wallet_connected", diagProvider)
      resolve(address)
    }

    function fail(err: Error) {
      if (settled) return
      settled = true
      clearInterval(snapshotInterval)
      wcProvider.off("connect", onConnect)
      wcProvider.off("accountsChanged", onAccountsChanged)
      wcProvider.off("disconnect", onDisconnect)
      logWcStoreSnapshot("wallet_connect_failed", diagProvider, {
        error: err.message,
      })
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
      settle(wcProvider.accounts[0])
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
