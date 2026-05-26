/**
 * POS-owned WalletConnect session helper for Base V6 payments.
 *
 * The POS terminal creates and owns the WC session so that all provider.request()
 * calls are made from the stable POS device. The resulting pairing URI is public
 * (Curve25519 public key + relay info only — the symmetric session key is derived
 * locally via ECDH on both sides and never transmitted) and is shared with the
 * hosted checkout purely so the customer can deep-link into their wallet.
 *
 * Dynamic import keeps the heavy WC bundle out of any server path.
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
  /** Tear down the WC session */
  disconnect(): Promise<void>
  /** Raw provider for advanced use */
  _provider: import("@walletconnect/ethereum-provider").default
}

type PosWcInitResult =
  | { ok: true; provider: PosWcProvider; pairingUri: string }
  | { ok: false; error: string }

/**
 * Initialize a fresh WalletConnect session owned by the POS terminal.
 *
 * Resolves once the pairing URI is available (display_uri event), before the
 * customer connects. The caller should then publish the URI to the API bridge
 * so the hosted checkout can surface deep-link wallet buttons.
 *
 * The returned PosWcProvider stays active until the caller calls disconnect()
 * or the wallet disconnects.
 */
export async function initPosBaseWalletConnect(): Promise<PosWcInitResult> {
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || ""
  if (!projectId) {
    return { ok: false, error: "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not configured" }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.pinetree-payments.com"

  try {
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

    return new Promise<PosWcInitResult>((resolve) => {
      let resolved = false

      const onDisplayUri = (uri: string) => {
        if (resolved) return
        resolved = true

        const posProvider: PosWcProvider = {
          get accounts() {
            return wcProvider.accounts
          },
          async request<T = unknown>(args: PosWcRequestArgs): Promise<T> {
            return wcProvider.request<T>(args as Parameters<typeof wcProvider.request>[0])
          },
          async disconnect() {
            try {
              await wcProvider.disconnect()
            } catch {
              // ignore — session may already be gone
            }
          },
          _provider: wcProvider,
        }

        resolve({ ok: true, provider: posProvider, pairingUri: uri })
      }

      // display_uri fires before the wallet connects, carrying the pairing URI
      wcProvider.on("display_uri", onDisplayUri)

      // Kick off the connection flow (non-blocking — resolves above via event)
      wcProvider.connect().catch((err: unknown) => {
        if (!resolved) {
          resolved = true
          resolve({
            ok: false,
            error: err instanceof Error ? err.message : "WalletConnect connect() failed",
          })
        }
      })

      // Safety timeout: if display_uri never fires, fail cleanly
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          resolve({ ok: false, error: "Timed out waiting for WalletConnect pairing URI" })
        }
      }, 20_000)
    })
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to init WalletConnect provider",
    }
  }
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
