/**
 * WalletConnect/Reown Explorer-backed Base wallet catalog.
 *
 * The POS terminal still owns the WalletConnect provider/session. Hosted
 * checkout only receives the POS-created pairing URI and launches a customer's
 * wallet into that pairing. We intentionally do not use the AppKit modal here:
 * it expects to control a live provider in the same browser context and can
 * expose QR/copy UI that is not appropriate for POS-hosted mobile checkout.
 */

const BASE_CHAIN = "eip155:8453"

export type BaseWalletReliability = "high" | "medium" | "disabled"

export type WalletConnectExplorerWallet = {
  id: string
  name: string
  slug?: string
  homepage?: string
  chains?: string[]
  image_id?: string
  image_url?: {
    sm?: string
    md?: string
    lg?: string
  }
  app?: {
    ios?: string | null
    android?: string | null
  }
  mobile?: {
    native?: string | null
    universal?: string | null
  }
  metadata?: {
    shortName?: string
  }
}

export type BaseWalletTarget = {
  id: string
  label: string
  explorerId: string
  explorerSearch: string
  iconSrc: string
  enabled: boolean
  reliability: BaseWalletReliability
  disabledReason?: string
  enableWhen?: string
  notes?: string
  /**
   * Reown AppKit has a few custom WalletConnect mobile link entries that do
   * not come through the generic Explorer mobile.native/mobile.universal pair.
   */
  mobileLinkOverride?: string
  linkModeOverride?: string
}

export type BaseWalletEntry = {
  id: string
  label: string
  iconSrc: string
  href: (pairingUri: string) => string
  enabled: boolean
  reliability: BaseWalletReliability
  explorerId: string
  source: "walletconnect-explorer" | "walletconnect-explorer-cache"
  installUrl?: string
  disabledReason?: string
  enableWhen?: string
  notes?: string
}

export type BaseWalletApiEntry = Omit<BaseWalletEntry, "href"> & {
  href: string
}

// Curated POS allow-list. Runtime wallet names, icons, supported chains, and
// mobile links are resolved from WalletConnect/Reown Explorer metadata by API.
export const BASE_WALLET_TARGETS: BaseWalletTarget[] = [
  {
    id: "metamask",
    label: "MetaMask",
    explorerId: "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96",
    explorerSearch: "MetaMask",
    iconSrc: "/wallet-icons/metamask.png",
    enabled: true,
    reliability: "high",
  },
  {
    id: "coinbase",
    label: "Coinbase Wallet",
    explorerId: "d0ca99ff52b99abc48743dad0f7fc891e041be73574f7fac4afe5d4bb83845c8",
    explorerSearch: "Coinbase Wallet",
    iconSrc: "/wallet-icons/coinbase-wallet.png",
    enabled: true,
    reliability: "high",
    mobileLinkOverride: "https://go.cb-w.com",
    notes: "Coinbase Wallet's Base-capable Explorer listing does not publish a mobile link; Reown AppKit uses Coinbase's official go.cb-w.com handoff.",
  },
  {
    id: "trust",
    label: "Trust Wallet",
    explorerId: "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0",
    explorerSearch: "Trust Wallet",
    iconSrc: "/wallet-icons/trust-wallet.png",
    enabled: true,
    reliability: "high",
  },
  {
    id: "rainbow",
    label: "Rainbow",
    explorerId: "1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369",
    explorerSearch: "Rainbow",
    iconSrc: "/wallet-icons/rainbow.png",
    enabled: true,
    reliability: "high",
  },
  {
    id: "phantom",
    label: "Phantom",
    explorerId: "a797aa35c0fadbfc1a53e7f675162ed5226968b44a19ee3d24385c64d1d3c393",
    explorerSearch: "Phantom",
    iconSrc: "/wallet-icons/phantom.png",
    enabled: true,
    reliability: "medium",
    mobileLinkOverride: "https://phantom.app",
    notes: "Phantom's Explorer wallet is Base-capable, but the listing omits mobile links; Reown AppKit treats Phantom as a custom mobile wallet.",
  },
  {
    id: "okx",
    label: "OKX Wallet",
    explorerId: "971e689d0a5be527bac79629b4ee9b925e82208e5168b733496a09c0faed0709",
    explorerSearch: "OKX Wallet",
    iconSrc: "/wallet-icons/okx-wallet.png",
    enabled: true,
    reliability: "medium",
  },
  {
    id: "zerion",
    label: "Zerion",
    explorerId: "ecc4036f814562b41a5268adc86270fba1365471402006302e70169465b7ac18",
    explorerSearch: "Zerion",
    iconSrc: "/wallet-icons/zerion.png",
    enabled: true,
    reliability: "high",
  },
  {
    id: "uniswap",
    label: "Uniswap Wallet",
    explorerId: "c03dfee351b6fcc421b4494ea33b9d4b92a984f87aa76d1663bb28705e95034a",
    explorerSearch: "Uniswap Wallet",
    iconSrc: "/wallet-icons/uniswap-wallet.png",
    enabled: true,
    reliability: "medium",
  },
  {
    id: "bitget",
    label: "Bitget Wallet",
    explorerId: "38f5d18bd8522c244bdd70cb4a68e0e718865155811c043f052fb9f1c51de662",
    explorerSearch: "Bitget Wallet",
    iconSrc: "/wallet-icons/bitget-wallet.png",
    enabled: true,
    reliability: "medium",
  },
  {
    id: "exodus",
    label: "Exodus",
    explorerId: "e9ff15be73584489ca4a66f64d32c4537711797e30b6660dbcb71ea72a42b1f4",
    explorerSearch: "Exodus",
    iconSrc: "/wallet-icons/exodus.png",
    enabled: false,
    reliability: "disabled",
    disabledReason: "WalletConnect Explorer's Exodus listing audited here does not advertise Base chain support.",
    enableWhen: "Enable after Explorer metadata lists eip155:8453 or live testing confirms Base WalletConnect payment approval.",
  },
  {
    id: "onekey",
    label: "OneKey",
    explorerId: "1aedbcfc1f31aade56ca34c38b0a1607b41cccfa3de93c946ef3b4ba2dfab11c",
    explorerSearch: "OneKey",
    iconSrc: "/wallet-icons/onekey.png",
    enabled: true,
    reliability: "medium",
  },
  {
    id: "tokenpocket",
    label: "TokenPocket",
    explorerId: "20459438007b75f4f4acb98bf29aa3b800550309646d375da5fd4aac6c2a2c66",
    explorerSearch: "TokenPocket",
    iconSrc: "/wallet-icons/tokenpocket.png",
    enabled: true,
    reliability: "medium",
  },
  {
    id: "rabby",
    label: "Rabby",
    explorerId: "18388be9ac2d02726dbac9777c96efaac06d744b2f6d580fccdd4127a6d01fd1",
    explorerSearch: "Rabby",
    iconSrc: "/wallet-icons/rabby.png",
    enabled: false,
    reliability: "disabled",
    disabledReason: "Explorer listing audited here does not publish Base support or reliable mobile links for POS same-phone WalletConnect.",
    enableWhen: "Enable after Explorer metadata or device testing confirms Base mobile WalletConnect handoff.",
  },
  {
    id: "safe",
    label: "Safe",
    explorerId: "225affb176778569276e484e1b92637ad061b01e13a048b35a9d280c3b58970f",
    explorerSearch: "Safe",
    iconSrc: "/wallet-icons/safe.png",
    enabled: false,
    reliability: "disabled",
    disabledReason: "Safe's smart-account/multisig flow is not a clean instant POS mobile checkout UX.",
    enableWhen: "Enable after product signs off on a Safe-specific POS flow and live tests confirm quick Base ETH/USDC approval.",
  },
  {
    id: "ledger-live",
    label: "Ledger Live",
    explorerId: "19177a98252e07ddfc9af2083ba8e07ef627cb6103467ffebb3f8f4205fd7927",
    explorerSearch: "Ledger Wallet",
    iconSrc: "/wallet-icons/ledger-live.png",
    enabled: false,
    reliability: "disabled",
    disabledReason: "Hardware-wallet approval flow and Ledger Live wc route need device testing before POS use.",
    enableWhen: "Enable after iOS/Android Ledger Live tests confirm pairing and Base V7 ETH/USDC prompts.",
  },
  {
    id: "binance-web3-wallet",
    label: "Binance Web3 Wallet",
    explorerId: "8a0ee50d1f22f6651afcae7eb4253e52a3310b90af5daef78a8c4929a9bb99d4",
    explorerSearch: "Binance Wallet",
    iconSrc: "/wallet-icons/binance-web3-wallet.png",
    enabled: false,
    reliability: "disabled",
    disabledReason: "Explorer lists Base support, but Binance Web3 Wallet's EVM WalletConnect mobile route needs live confirmation for POS checkout.",
    enableWhen: "Enable after Binance Web3 Wallet same-phone WalletConnect handoff is verified on iOS/Android.",
  },
]

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://")
}

function appendWalletConnectUri(baseUrl: string, pairingUri: string): string {
  const encodedUri = encodeURIComponent(pairingUri)
  const trimmed = baseUrl.trim()
  if (!trimmed) return ""

  if (trimmed.includes("{uri}")) {
    return trimmed.replace("{uri}", encodedUri)
  }

  if (trimmed.endsWith("/wc") || trimmed.endsWith("/wc/")) {
    const normalized = trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed
    return `${normalized}?uri=${encodedUri}`
  }

  const safeBase = ensureTrailingSlash(trimmed)
  return `${safeBase}wc?uri=${encodedUri}`
}

/**
 * Mirrors Reown AppKit's mobile WalletConnect link formatting without opening
 * the AppKit modal or creating another provider session.
 */
export function formatWalletConnectMobileLink(input: {
  mobileLink: string
  pairingUri: string
}): string {
  const { mobileLink, pairingUri } = input
  if (isHttpUrl(mobileLink)) {
    return appendWalletConnectUri(mobileLink, pairingUri)
  }

  const withoutExtraSlash = mobileLink.includes("://")
    ? mobileLink
    : `${mobileLink.replaceAll("/", "").replaceAll(":", "")}://`

  return appendWalletConnectUri(withoutExtraSlash, pairingUri)
}

function installUrlFor(wallet: WalletConnectExplorerWallet | null, target: BaseWalletTarget): string | undefined {
  return (
    wallet?.app?.ios ||
    wallet?.app?.android ||
    wallet?.homepage ||
    (target.id === "coinbase" ? "https://www.coinbase.com/wallet" : undefined)
  )
}

export function createBaseWalletEntry(
  target: BaseWalletTarget,
  wallet: WalletConnectExplorerWallet | null = null
): BaseWalletEntry {
  const mobileLink =
    target.mobileLinkOverride ||
    wallet?.mobile?.native ||
    wallet?.mobile?.universal ||
    target.linkModeOverride ||
    ""

  return {
    id: target.id,
    label: wallet?.metadata?.shortName || wallet?.name || target.label,
    iconSrc: target.iconSrc,
    href: (pairingUri) =>
      mobileLink
        ? formatWalletConnectMobileLink({ mobileLink, pairingUri })
        : "",
    enabled: target.enabled && Boolean(mobileLink),
    reliability: target.reliability,
    explorerId: target.explorerId,
    source: wallet ? "walletconnect-explorer" : "walletconnect-explorer-cache",
    installUrl: installUrlFor(wallet, target),
    disabledReason:
      target.disabledReason ||
      (!mobileLink ? "WalletConnect Explorer metadata did not provide a mobile wallet link." : undefined),
    enableWhen: target.enableWhen,
    notes: target.notes,
  }
}

export function walletSupportsBase(wallet: WalletConnectExplorerWallet | null): boolean {
  return Boolean(wallet?.chains?.includes(BASE_CHAIN))
}

const BASE_WALLETS: BaseWalletEntry[] = BASE_WALLET_TARGETS.map((target) =>
  createBaseWalletEntry(target)
)

export default BASE_WALLETS
