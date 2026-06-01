import type { Transaction, VersionedTransaction } from "@solana/web3.js"

// Disabled in merchant Send UI because generic Solana WalletConnect cannot be constrained
// to Phantom/Solflare and may open unsupported wallets. Keep this helper unused until
// wallet-specific mobile signing callback support is implemented.

const SOLANA_MAINNET_CHAIN_ID = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
const SOLANA_DEPRECATED_MAINNET_CHAIN_ID = "solana:4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ"
const SOLANA_SIGN_AND_SEND = "solana_signAndSendTransaction"

type WalletConnectSession = {
  topic: string
  namespaces?: {
    solana?: {
      accounts?: string[]
      methods?: string[]
    }
  }
}

type UniversalProviderLike = {
  session?: WalletConnectSession
  connect: (opts: unknown) => Promise<WalletConnectSession | undefined>
  request: <T = unknown>(args: { method: string; params?: unknown }, chain?: string) => Promise<T>
  disconnect: () => Promise<void>
  abortPairingAttempt?: () => void
  cleanupPendingPairings?: () => Promise<void>
  on: (event: string, listener: (...args: unknown[]) => void) => void
  off: (event: string, listener: (...args: unknown[]) => void) => void
}

export type MerchantSolanaWcProvider = {
  get account(): string
  waitForConnect(): Promise<string>
  signAndSendTransaction(transaction: Transaction | VersionedTransaction): Promise<string>
  disconnect(): Promise<void>
  _provider: UniversalProviderLike
}

export type MerchantSolanaWcInitResult =
  | { ok: true; provider: MerchantSolanaWcProvider; pairingUri: string }
  | { ok: false; error: string }

function getSessionAccount(session?: WalletConnectSession): string {
  const accountId = session?.namespaces?.solana?.accounts?.[0] || ""
  const parts = accountId.split(":")
  return String(parts[2] || "").trim()
}

function supportsSignAndSend(session?: WalletConnectSession): boolean {
  return Boolean(session?.namespaces?.solana?.methods?.includes(SOLANA_SIGN_AND_SEND))
}

function serializeTransaction(transaction: Transaction | VersionedTransaction): string {
  return Buffer.from(transaction.serialize({ verifySignatures: false })).toString("base64")
}

export async function initMerchantSolanaWalletConnect(): Promise<MerchantSolanaWcInitResult> {
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || ""
  if (!projectId) {
    return { ok: false, error: "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not configured." }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.pinetree-payments.com"

  try {
    const { default: UniversalProvider } = await import("@walletconnect/universal-provider")
    const wcProvider = await UniversalProvider.init({
      projectId,
      metadata: {
        name: "PineTree Payments",
        description: "Merchant Solana wallet approval for PineTree sends",
        url: appUrl,
        icons: []
      }
    }) as UniversalProviderLike

    let connectedSession: WalletConnectSession | undefined = wcProvider.session
    let connectReject: ((err: Error) => void) | null = null

    const connectPromise = new Promise<string>((resolve, reject) => {
      connectReject = reject
      wcProvider.connect({
        optionalNamespaces: {
          solana: {
            chains: [SOLANA_MAINNET_CHAIN_ID, SOLANA_DEPRECATED_MAINNET_CHAIN_ID],
            methods: ["solana_signTransaction", "solana_signMessage", SOLANA_SIGN_AND_SEND],
            events: []
          }
        }
      }).then((session) => {
        connectedSession = session || wcProvider.session
        const account = getSessionAccount(connectedSession)
        if (!account) {
          reject(new Error("Solana wallet connected without an account."))
          return
        }
        if (!supportsSignAndSend(connectedSession)) {
          reject(new Error("Connected Solana wallet does not support WalletConnect transaction submission."))
          return
        }
        resolve(account)
      }).catch((err: unknown) => {
        reject(err instanceof Error ? err : new Error("Solana WalletConnect connection failed."))
      })
    })

    return await new Promise<MerchantSolanaWcInitResult>((resolve) => {
      let resolved = false

      const onDisplayUri = (uri: unknown) => {
        if (resolved || typeof uri !== "string" || !uri) return
        resolved = true

        const provider: MerchantSolanaWcProvider = {
          get account() {
            return getSessionAccount(connectedSession || wcProvider.session)
          },
          waitForConnect() {
            return connectPromise
          },
          async signAndSendTransaction(transaction: Transaction | VersionedTransaction): Promise<string> {
            const session = connectedSession || wcProvider.session
            if (!session) throw new Error("Solana wallet is not connected.")
            if (!supportsSignAndSend(session)) {
              throw new Error("Connected Solana wallet does not support WalletConnect transaction submission.")
            }
            const response = await wcProvider.request<{ signature?: string }>(
              {
                method: SOLANA_SIGN_AND_SEND,
                params: { transaction: serializeTransaction(transaction) }
              },
              SOLANA_MAINNET_CHAIN_ID
            )
            return String(response?.signature || "").trim()
          },
          async disconnect() {
            try {
              wcProvider.abortPairingAttempt?.()
              if (wcProvider.session) await wcProvider.disconnect()
              await wcProvider.cleanupPendingPairings?.()
            } catch {
              // Session may already be closed or the pairing may not have completed.
            }
          },
          _provider: wcProvider
        }

        resolve({ ok: true, provider, pairingUri: uri })
      }

      const onSessionDelete = () => {
        connectReject?.(new Error("Wallet disconnected before approving."))
      }

      wcProvider.on("display_uri", onDisplayUri)
      wcProvider.on("session_delete", onSessionDelete)

      setTimeout(() => {
        if (!resolved) {
          resolved = true
          wcProvider.off("display_uri", onDisplayUri)
          wcProvider.off("session_delete", onSessionDelete)
          wcProvider.abortPairingAttempt?.()
          resolve({ ok: false, error: "WalletConnect did not produce a Solana pairing URI. Check NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID." })
        }
      }, 15_000)
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to initialize Solana WalletConnect" }
  }
}
