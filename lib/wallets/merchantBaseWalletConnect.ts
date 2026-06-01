/**
 * Merchant-owned WalletConnect session for Base merchant sends.
 *
 * Architecturally separate from the POS WalletConnect session (posBaseWalletConnect.ts),
 * which handles customer payment acceptance. This session is created by the merchant
 * dashboard to approve outbound merchant sends via the merchant's own phone wallet.
 *
 * Flow:
 *  1. Dashboard calls initMerchantBaseWalletConnect()
 *  2. Pairing URI returned → displayed as a QR code on dashboard
 *  3. Merchant scans with Base Wallet / MetaMask / Trust Wallet on their phone
 *  4. waitForMerchantWalletConnect() resolves with connected address
 *  5. Dashboard sends eth_sendTransaction through the session
 *  6. Merchant approves on phone → tx hash returned
 *  7. Activity persisted to PineTree
 */

const BASE_CHAIN_ID = 8453

export type MerchantWcProvider = {
  /** Connected wallet address (available after waitForMerchantWalletConnect resolves) */
  get account(): string
  /** Send a JSON-RPC request through the WC session */
  request<T = unknown>(method: string, params?: unknown[]): Promise<T>
  /** Tear down the WC session */
  disconnect(): Promise<void>
  /** Raw EthereumProvider for event listening in waitForMerchantWalletConnect */
  _provider: import("@walletconnect/ethereum-provider").default
}

export type MerchantWcInitResult =
  | { ok: true; provider: MerchantWcProvider; pairingUri: string }
  | { ok: false; error: string }

/**
 * Initialize a WalletConnect session for merchant wallet approval.
 * Resolves once the pairing URI (QR content) is available.
 * Display the URI as a QR code, then call waitForMerchantWalletConnect().
 */
export async function initMerchantBaseWalletConnect(): Promise<MerchantWcInitResult> {
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || ""
  if (!projectId) {
    return { ok: false, error: "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not configured." }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.pinetree-payments.com"

  try {
    const { default: EthereumProvider } = await import("@walletconnect/ethereum-provider")

    const wcProvider = await EthereumProvider.init({
      projectId,
      chains: [BASE_CHAIN_ID],
      optionalChains: [BASE_CHAIN_ID],
      showQrModal: false,
      methods: ["eth_sendTransaction", "eth_requestAccounts", "eth_accounts"],
      events: ["accountsChanged", "chainChanged", "disconnect"],
      metadata: {
        name: "PineTree Payments",
        description: "Merchant wallet approval for PineTree sends",
        url: appUrl,
        icons: []
      }
    })

    return new Promise<MerchantWcInitResult>((resolve) => {
      let resolved = false

      function onDisplayUri(uri: string) {
        if (resolved) return
        resolved = true

        const provider: MerchantWcProvider = {
          get account() {
            return wcProvider.accounts[0] || ""
          },
          async request<T = unknown>(method: string, params?: unknown[]): Promise<T> {
            return wcProvider.request<T>({ method, params } as Parameters<typeof wcProvider.request>[0])
          },
          async disconnect() {
            try { await wcProvider.disconnect() } catch { /* session may already be gone */ }
          },
          _provider: wcProvider
        }

        resolve({ ok: true, provider, pairingUri: uri })
      }

      wcProvider.on("display_uri", onDisplayUri)

      wcProvider.connect().catch((err: unknown) => {
        if (!resolved) {
          resolved = true
          resolve({ ok: false, error: err instanceof Error ? err.message : "WalletConnect connection failed" })
        }
      })

      setTimeout(() => {
        if (!resolved) {
          resolved = true
          resolve({ ok: false, error: "WalletConnect did not produce a pairing URI. Check NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID." })
        }
      }, 15_000)
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to initialize WalletConnect" }
  }
}

/**
 * Wait for the merchant's wallet to connect to the pairing session.
 * Call after displaying the QR code from initMerchantBaseWalletConnect().
 * Resolves with the connected wallet address, or rejects on timeout/disconnect.
 */
export async function waitForMerchantWalletConnect(provider: MerchantWcProvider): Promise<string> {
  const raw = provider._provider

  // If already connected from a resumed session, return immediately
  if (raw.connected && raw.accounts.length > 0) {
    return raw.accounts[0]
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false

    function settle(address: string) {
      if (settled) return
      settled = true
      raw.removeListener("connect", onConnect)
      raw.removeListener("accountsChanged", onAccountsChanged)
      raw.removeListener("disconnect", onDisconnect)
      resolve(address)
    }

    function fail(err: Error) {
      if (settled) return
      settled = true
      raw.removeListener("connect", onConnect)
      raw.removeListener("accountsChanged", onAccountsChanged)
      raw.removeListener("disconnect", onDisconnect)
      reject(err)
    }

    function onConnect() {
      settle(raw.accounts[0] || "")
    }

    function onAccountsChanged(accounts: unknown) {
      const arr = Array.isArray(accounts) ? (accounts as string[]) : []
      if (arr.length > 0) settle(arr[0])
    }

    function onDisconnect() {
      fail(new Error("Wallet disconnected before approving."))
    }

    raw.on("connect", onConnect)
    raw.on("accountsChanged", onAccountsChanged)
    raw.on("disconnect", onDisconnect)

    setTimeout(() => {
      fail(new Error("Timed out waiting for wallet to connect. Scan the QR code with your wallet app."))
    }, 120_000)
  })
}
