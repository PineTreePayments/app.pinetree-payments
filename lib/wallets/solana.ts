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

type WalletStandardRegistry = {
  get?: () => WalletStandardProvider[]
  register?: (...wallets: WalletStandardProvider[]) => unknown
}

type WalletStandardRegisterCallback = (api: { register: (...wallets: WalletStandardProvider[]) => unknown }) => unknown

export type SolanaBrowserProvider = {
  isPhantom?: boolean
  isSolflare?: boolean
  name?: string
  publicKey?: { toString: () => string }
  providers?: SolanaBrowserProvider[]
  connect: () => Promise<unknown>
  signAndSendTransaction: (transaction: unknown) => Promise<{ signature?: string; signatures?: string[] } | string>
}

export type DetectedSolanaWallet = {
  id: string
  name: string
  provider: SolanaBrowserProvider
  source: "injected" | "wallet-standard"
}

type SolanaBrowserWindow = Window & {
  solana?: SolanaBrowserProvider
  phantom?: { solana?: SolanaBrowserProvider }
  solflare?: SolanaBrowserProvider
  backpack?: { solana?: SolanaBrowserProvider } | SolanaBrowserProvider
  glow?: SolanaBrowserProvider
  glowSolana?: SolanaBrowserProvider
  trustwallet?: { solana?: SolanaBrowserProvider }
  coinbaseSolana?: SolanaBrowserProvider
  okxwallet?: { solana?: SolanaBrowserProvider }
  braveSolana?: SolanaBrowserProvider
  wallets?: WalletStandardRegistry | WalletStandardProvider[]
  "wallet-standard:wallets"?: WalletStandardRegistry | WalletStandardProvider[]
}

const walletStandardRegistry = {
  initialized: false,
  wallets: [] as WalletStandardProvider[],
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

function getBackpackSolanaProvider(value: SolanaBrowserWindow["backpack"]): SolanaBrowserProvider | undefined {
  if (isSolanaBrowserProvider(value)) return value
  return isSolanaBrowserProvider(value?.solana) ? value.solana : undefined
}

function normalizeWalletDisplayName(name: string): string {
  const value = String(name || "").trim()
  const comparable = value.toLowerCase()
  if (comparable.includes("phantom")) return "Phantom"
  if (comparable.includes("solflare")) return "Solflare"
  if (comparable.includes("backpack")) return "Backpack"
  if (comparable.includes("glow")) return "Glow"
  if (comparable.includes("trust")) return "Trust Wallet"
  if (comparable.includes("coinbase")) return "Coinbase Wallet"
  if (comparable.includes("okx")) return "OKX Wallet"
  if (comparable.includes("brave")) return "Brave Wallet"
  return value
}

function walletNameKey(name: string): string {
  const normalized = normalizeWalletDisplayName(name)
  return normalized.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function accountPublicKeyToString(account?: WalletStandardAccount): string {
  if (!account) return ""
  if (account.address) return String(account.address).trim()

  const key = account.publicKey
  if (!key) return ""
  if (key instanceof Uint8Array) return bs58.encode(key)
  return String(key.toString()).trim()
}

function getRegistryWallets(source?: WalletStandardRegistry | WalletStandardProvider[] | WalletStandardRegisterCallback[]): WalletStandardProvider[] {
  try {
    if (Array.isArray(source)) {
      return source.filter((wallet): wallet is WalletStandardProvider => {
        return Boolean(wallet) && typeof wallet === "object" && "features" in wallet
      })
    }

    const wallets = source?.get?.()
    return Array.isArray(wallets) ? wallets : []
  } catch {
    return []
  }
}

function registerWalletStandardProviders(...wallets: WalletStandardProvider[]): void {
  for (const wallet of wallets) {
    if (!walletStandardRegistry.wallets.includes(wallet)) {
      walletStandardRegistry.wallets.push(wallet)
    }
  }
}

function initializeWalletStandardDiscovery(w: SolanaBrowserWindow): void {
  if (walletStandardRegistry.initialized) return
  walletStandardRegistry.initialized = true

  const api = Object.freeze({ register: registerWalletStandardProviders })

  try {
    w.addEventListener("wallet-standard:register-wallet", (event) => {
      const callback = (event as Event & { detail?: WalletStandardRegisterCallback }).detail
      if (typeof callback === "function") callback(api)
    })
  } catch {
    // Wallet Standard is best-effort; injected globals still work if event wiring is unavailable.
  }

  try {
    w.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api }))
  } catch {
    // Ignore browsers/extensions that reject the event.
  }

  const navigatorWallets = typeof navigator === "undefined"
    ? undefined
    : (navigator as Navigator & { wallets?: WalletStandardRegisterCallback[] | WalletStandardRegistry | WalletStandardProvider[] }).wallets

  if (Array.isArray(navigatorWallets)) {
    for (const callback of navigatorWallets) {
      if (typeof callback === "function") {
        try {
          callback(api)
        } catch {
          // Skip malformed legacy callbacks.
        }
      }
    }
  }
}

function getWalletStandardProviders(w: SolanaBrowserWindow): WalletStandardProvider[] {
  initializeWalletStandardDiscovery(w)

  const navigatorWallets = (typeof navigator === "undefined"
    ? undefined
    : (navigator as Navigator & { wallets?: WalletStandardRegistry | WalletStandardProvider[] }).wallets)

  const sources = [walletStandardRegistry.wallets, w.wallets, w["wallet-standard:wallets"], navigatorWallets]
  return sources.flatMap((source) => {
    return getRegistryWallets(source)
  })
}

function createWalletStandardProvider(wallet: WalletStandardProvider): SolanaBrowserProvider | null {
  const name = String(wallet.name || "").toLowerCase()
  const chains = Array.isArray(wallet.chains) ? wallet.chains.map((chain) => String(chain).toLowerCase()) : []
  const supportsSolanaChain = chains.some((chain) => chain.includes("solana"))
  const features = wallet.features || {}
  const featureNames = Object.keys(features).map((feature) => feature.toLowerCase())
  const supportsSolanaFeature = featureNames.some((feature) => feature.includes("solana"))
  const connectFeature = features["standard:connect"] as WalletStandardFeature | undefined
  const signAndSendFeature = features["solana:signAndSendTransaction"] as WalletStandardFeature | undefined

  if (!name || (!supportsSolanaChain && !supportsSolanaFeature)) return null
  if (typeof connectFeature?.connect !== "function") return null
  if (typeof signAndSendFeature?.signAndSendTransaction !== "function") return null

  let connectedAccounts = Array.isArray(wallet.accounts) ? wallet.accounts : []
  let connectedPublicKey = accountPublicKeyToString(connectedAccounts[0])

  return {
    name: wallet.name,
    isPhantom: name.includes("phantom"),
    isSolflare: name.includes("solflare"),
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

function createWalletStandardPhantomProvider(wallet: WalletStandardProvider): SolanaBrowserProvider | null {
  const provider = createWalletStandardProvider(wallet)
  return provider?.isPhantom ? provider : null
}

function getInjectedProviderName(provider: SolanaBrowserProvider, fallback: string): string {
  const named = String(provider.name || "").trim()
  if (named) return normalizeWalletDisplayName(named)
  if (provider.isPhantom) return "Phantom"
  if (provider.isSolflare) return "Solflare"
  const w = getSolanaWindow()
  if (provider === getBackpackSolanaProvider(w?.backpack)) return "Backpack"
  if (provider === w?.glowSolana || provider === w?.glow) return "Glow"
  if (provider === w?.trustwallet?.solana) return "Trust Wallet"
  if (provider === w?.coinbaseSolana) return "Coinbase Wallet"
  if (provider === w?.okxwallet?.solana) return "OKX Wallet"
  if (provider === w?.braveSolana) return "Brave Wallet"
  return fallback
}

function walletId(name: string, source: string, index: number): string {
  const slug = String(name || "solana-wallet")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `${source}-${slug || "wallet"}-${index}`
}

export function getDetectedSolanaWallets(): DetectedSolanaWallet[] {
  const w = getSolanaWindow()
  if (!w) return []

  const detected: DetectedSolanaWallet[] = []
  const seenProviders = new Set<SolanaBrowserProvider>()
  const seenNames = new Set<string>()
  const backpackSolana = getBackpackSolanaProvider(w.backpack)

  const injectedCandidates = uniqueProviders([
    isSolanaBrowserProvider(w.solana) ? w.solana : null,
    isSolanaBrowserProvider(w.phantom?.solana) ? w.phantom?.solana : null,
    isSolanaBrowserProvider(w.solflare) ? w.solflare : null,
    backpackSolana,
    isSolanaBrowserProvider(w.glowSolana) ? w.glowSolana : null,
    isSolanaBrowserProvider(w.glow) ? w.glow : null,
    isSolanaBrowserProvider(w.trustwallet?.solana) ? w.trustwallet?.solana : null,
    isSolanaBrowserProvider(w.coinbaseSolana) ? w.coinbaseSolana : null,
    isSolanaBrowserProvider(w.okxwallet?.solana) ? w.okxwallet?.solana : null,
    isSolanaBrowserProvider(w.braveSolana) ? w.braveSolana : null,
    ...(w.phantom?.solana?.providers ?? []).filter(isSolanaBrowserProvider),
    ...(w.solana?.providers ?? []).filter(isSolanaBrowserProvider),
  ])

  for (const provider of injectedCandidates) {
    if (seenProviders.has(provider)) continue
    seenProviders.add(provider)
    const name = getInjectedProviderName(provider, "Solana Wallet")
    const normalizedName = walletNameKey(name)
    seenNames.add(normalizedName)
    detected.push({
      id: walletId(name, "injected", detected.length),
      name,
      provider,
      source: "injected",
    })
  }

  for (const wallet of getWalletStandardProviders(w)) {
    const provider = createWalletStandardProvider(wallet)
    if (!provider) continue
    const name = normalizeWalletDisplayName(String(wallet.name || provider.name || "Solana Wallet").trim())
    const normalizedName = walletNameKey(name)
    if (seenNames.has(normalizedName)) continue
    seenNames.add(normalizedName)
    detected.push({
      id: walletId(name, "standard", detected.length),
      name,
      provider,
      source: "wallet-standard",
    })
  }

  return detected
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
