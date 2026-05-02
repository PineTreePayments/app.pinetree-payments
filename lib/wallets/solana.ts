import bs58 from "bs58"

type WalletStandardAccount = {
  address?: string
  publicKey?: Uint8Array | { toString: () => string }
}

type WalletStandardConnectResult = {
  accounts?: WalletStandardAccount[]
}

type WalletStandardFeature = {
  connect?: () => Promise<WalletStandardConnectResult | unknown>
  signAndSendTransaction?: (input: unknown) => Promise<unknown>
}

type WalletStandardProvider = {
  name?: string
  chains?: string[]
  features?: Record<string, WalletStandardFeature | unknown>
  accounts?: WalletStandardAccount[]
}

export type SolanaBrowserProvider = {
  isPhantom?: boolean
  isSolflare?: boolean
  publicKey?: { toString: () => string }
  providers?: SolanaBrowserProvider[]
  connect: () => Promise<unknown>
  signAndSendTransaction: (transaction: unknown) => Promise<{ signature?: string; signatures?: string[] } | string>
}

type SolanaBrowserWindow = Window & {
  solana?: SolanaBrowserProvider
  phantom?: { solana?: SolanaBrowserProvider }
  solflare?: SolanaBrowserProvider
  wallets?: {
    get?: () => WalletStandardProvider[]
  }
}

function getSolanaWindow(): SolanaBrowserWindow | null {
  if (typeof window === "undefined") return null
  return window as SolanaBrowserWindow
}

export function isMobileBrowser(userAgent?: string): boolean {
  const ua = userAgent ?? (typeof navigator === "undefined" ? "" : navigator.userAgent)
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
}

function isSolanaBrowserProvider(value: unknown): value is SolanaBrowserProvider {
  const provider = value as Partial<SolanaBrowserProvider> | null
  return Boolean(
    provider &&
      typeof provider === "object" &&
      typeof provider.connect === "function" &&
      typeof provider.signAndSendTransaction === "function"
  )
}

function uniqueProviders(providers: Array<SolanaBrowserProvider | null | undefined>): SolanaBrowserProvider[] {
  return providers.filter((provider, index, list): provider is SolanaBrowserProvider => {
    return Boolean(provider) && list.indexOf(provider) === index
  })
}

function accountPublicKeyToString(account?: WalletStandardAccount): string {
  if (!account) return ""
  if (account.address) return String(account.address).trim()

  const key = account.publicKey
  if (!key) return ""
  if (key instanceof Uint8Array) return bs58.encode(key)
  return String(key.toString()).trim()
}

function getWalletStandardProviders(w: SolanaBrowserWindow): WalletStandardProvider[] {
  const navigatorWallets = (typeof navigator === "undefined"
    ? undefined
    : (navigator as Navigator & { wallets?: { get?: () => WalletStandardProvider[] } }).wallets)

  const sources = [w.wallets, navigatorWallets]
  return sources.flatMap((source) => {
    try {
      const providers = source?.get?.()
      return Array.isArray(providers) ? providers : []
    } catch {
      return []
    }
  })
}

function createWalletStandardPhantomProvider(wallet: WalletStandardProvider): SolanaBrowserProvider | null {
  const name = String(wallet.name || "").toLowerCase()
  const hasPhantomName = name.includes("phantom")
  const chains = Array.isArray(wallet.chains) ? wallet.chains.map((chain) => String(chain).toLowerCase()) : []
  const supportsSolanaChain = chains.some((chain) => chain.includes("solana"))
  const features = wallet.features || {}
  const featureNames = Object.keys(features).map((feature) => feature.toLowerCase())
  const supportsSolanaFeature = featureNames.some((feature) => feature.includes("solana"))
  const connectFeature = features["standard:connect"] as WalletStandardFeature | undefined
  const signAndSendFeature = features["solana:signAndSendTransaction"] as WalletStandardFeature | undefined

  if (!hasPhantomName || (!supportsSolanaChain && !supportsSolanaFeature)) return null
  if (typeof connectFeature?.connect !== "function") return null
  if (typeof signAndSendFeature?.signAndSendTransaction !== "function") return null

  let connectedAccounts = Array.isArray(wallet.accounts) ? wallet.accounts : []
  let connectedPublicKey = accountPublicKeyToString(connectedAccounts[0])

  return {
    isPhantom: true,
    get publicKey() {
      return connectedPublicKey ? { toString: () => connectedPublicKey } : undefined
    },
    connect: async () => {
      const result = await connectFeature.connect?.()
      const accounts = (result as WalletStandardConnectResult | null)?.accounts
      if (Array.isArray(accounts) && accounts.length > 0) {
        connectedAccounts = accounts
      } else if (Array.isArray(wallet.accounts) && wallet.accounts.length > 0) {
        connectedAccounts = wallet.accounts
      }

      connectedPublicKey = accountPublicKeyToString(connectedAccounts[0])
      return { publicKey: { toString: () => connectedPublicKey } }
    },
    signAndSendTransaction: async (transaction: unknown) => {
      const account = connectedAccounts[0] || wallet.accounts?.[0]
      const chain = wallet.chains?.find((value) => String(value).toLowerCase().includes("mainnet")) ||
        wallet.chains?.find((value) => String(value).toLowerCase().includes("solana")) ||
        "solana:mainnet"
      const serializable = transaction as {
        serialize?: (config?: { requireAllSignatures?: boolean; verifySignatures?: boolean }) => Uint8Array | Buffer
      }
      const serializedTransaction = typeof serializable.serialize === "function"
        ? serializable.serialize({ requireAllSignatures: false, verifySignatures: false })
        : transaction
      const result = await signAndSendFeature.signAndSendTransaction?.({
        account,
        chain,
        transaction: serializedTransaction,
      })
      const signature = getSolanaTransactionSignature(result as { signature?: string; signatures?: string[] } | string)
      return signature ? { signature } : (result as { signature?: string; signatures?: string[] } | string)
    },
  }
}

export function getInjectedPhantomProvider(): SolanaBrowserProvider | null {
  const w = getSolanaWindow()
  if (!w) return null

  const injectedCandidates = uniqueProviders([
    isSolanaBrowserProvider(w.phantom?.solana) ? w.phantom?.solana : null,
    isSolanaBrowserProvider(w.solana) ? w.solana : null,
    ...(w.phantom?.solana?.providers ?? []).filter(isSolanaBrowserProvider),
    ...(w.solana?.providers ?? []).filter(isSolanaBrowserProvider),
  ])

  const directPhantomProvider = injectedCandidates.find((provider) => provider === w.phantom?.solana)
  if (directPhantomProvider?.isPhantom === true) return directPhantomProvider

  const windowSolanaProvider = injectedCandidates.find((provider) => provider === w.solana)
  if (windowSolanaProvider?.isPhantom === true) return windowSolanaProvider

  const arrayPhantomProvider = injectedCandidates.find((provider) => provider.isPhantom === true)
  if (arrayPhantomProvider) return arrayPhantomProvider

  const standardPhantomProvider = getWalletStandardProviders(w)
    .map(createWalletStandardPhantomProvider)
    .find((provider): provider is SolanaBrowserProvider => Boolean(provider))

  return standardPhantomProvider ?? null
}

export function getSolanaProviderPublicKey(
  provider: SolanaBrowserProvider,
  connectResult: unknown,
): string {
  const connectedPublicKey = (connectResult as { publicKey?: { toString: () => string } } | null)?.publicKey?.toString()
  return String(connectedPublicKey || provider.publicKey?.toString() || "").trim()
}

export function getSolanaTransactionSignature(result: { signature?: string | Uint8Array; signatures?: Array<string | Uint8Array> } | string | unknown): string {
  if (typeof result === "string") return result.trim()
  const payload = result as { signature?: string | Uint8Array; signatures?: Array<string | Uint8Array> } | null
  const signature = payload?.signature || payload?.signatures?.[0]
  if (signature instanceof Uint8Array) return bs58.encode(signature)
  return String(signature || "").trim()
}

type PhantomWalletBrowserInput = {
  currentHref: string
  paymentId: string
  intentId?: string | null
  selectedAsset?: string | null
  selectedNetwork?: string | null
}

function buildPhantomCheckoutTargetUrl(input: PhantomWalletBrowserInput): URL {
  const targetUrl = new URL(input.currentHref)
  targetUrl.searchParams.set("mode", "wallet-browser")
  targetUrl.searchParams.set("wallet", "phantom")
  targetUrl.searchParams.set("pinetree_payment_id", input.paymentId)
  if (input.intentId) targetUrl.searchParams.set("intent", input.intentId)
  if (input.selectedAsset) targetUrl.searchParams.set("asset", input.selectedAsset)
  if (input.selectedNetwork) targetUrl.searchParams.set("network", input.selectedNetwork)
  targetUrl.searchParams.delete("status")
  targetUrl.searchParams.delete("phantom_error")
  targetUrl.searchParams.delete("solflare_error")
  return targetUrl
}

export function buildPhantomWalletBrowserUrl(input: PhantomWalletBrowserInput): string {
  const targetUrl = buildPhantomCheckoutTargetUrl(input)

  return `phantom://browse/${encodeURIComponent(targetUrl.toString())}`
}