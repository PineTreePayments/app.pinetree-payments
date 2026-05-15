/**
 * Payment App / Wallet Capability Registry
 *
 * Pure data — no server imports, no environment reads.
 * Used for display labels, capability routing, and simulator support only.
 *
 * Architecture: UI (lib/) → component → API → ENGINE → DB
 *
 * Vocabulary:
 *   - "app family"    = the product family (e.g. "coinbase" = exchange app,
 *                       "coinbase_wallet" = self-custody wallet — distinct products)
 *   - "rail"          = the underlying payment network (base, solana, bitcoin_lightning)
 *   - "asset"         = token or coin symbol (ETH, USDC, SOL, BTC)
 *   - "open strategy" = how PineTree attempts to bring the wallet app to the foreground
 */

// ─── Rails ────────────────────────────────────────────────────────────────────

export type PaymentRail = "base" | "solana" | "bitcoin_lightning"

// ─── App families ─────────────────────────────────────────────────────────────

export type AppFamily =
  // Base / EVM
  | "coinbase"         // Coinbase exchange app (Coinbase.com) — NOT the self-custody wallet
  | "coinbase_wallet"  // Coinbase Wallet (self-custody, separate product from Coinbase app)
  | "trust"
  | "metamask"
  | "rainbow"
  | "kraken"
  // Solana
  | "phantom"
  | "solflare"
  | "backpack"
  | "glow"
  | "okx"
  // Lightning / Bitcoin
  | "cash_app"
  | "strike"
  | "phoenix"
  | "zeus"
  | "breez"
  | "wallet_of_satoshi"
  | "muun"
  | "bluewallet"
  // Generic
  | "generic"

// ─── Mobile open strategies ───────────────────────────────────────────────────

/**
 * How PineTree attempts to open the wallet app on mobile.
 *
 * solana_uri          — navigate to `solana:${paymentUrl}` (Solana Pay protocol)
 * lightning_uri       — navigate to `lightning:${invoice}` (BOLT-11 standard)
 * wallet_deep_link    — wallet-specific `https://` or `scheme://` link that opens
 *                       the wallet's in-app browser at a target URL (Solana dapp flow)
 * phantom_browser     — Phantom-specific URL that opens this page in Phantom's in-app browser
 * solflare_universal  — Solflare Universal Link v1 (connect + sign deeplink protocol)
 * walletconnect       — WalletConnect modal / QR code (used for Base)
 * invoice_scheme      — wallet-specific URI scheme carrying the BOLT-11 invoice
 *                       (e.g. phoenix:lightning:${invoice}, zeusln:${invoice})
 * none                — no known mobile deep-link path
 */
export type MobileOpenStrategy =
  | "solana_uri"
  | "lightning_uri"
  | "wallet_deep_link"
  | "phantom_browser"
  | "solflare_universal"
  | "walletconnect"
  | "invoice_scheme"
  | "none"

// ─── Core record type ─────────────────────────────────────────────────────────

export type PaymentApp = {
  /** Stable ID — matches wallet catalog IDs used in SolanaWalletPayment / LightningPayment */
  id: string
  /** Label shown to customers */
  displayName: string
  /** Product family. Coinbase exchange ≠ Coinbase Wallet. */
  appFamily: AppFamily
  /** Payment rails this app can handle */
  railSupport: PaymentRail[]
  /** Assets this app supports (SOL, USDC, ETH, BTC …) */
  assetSupport: string[]
  /** How PineTree opens this app on mobile */
  mobileOpenStrategy: MobileOpenStrategy
  /** Install / download page */
  installUrl: string
  /** Native URI scheme prefix, if known (e.g. "cashapp://", "phoenix:") */
  nativeScheme?: string
  /** Universal/app link for mobile (https://…) */
  universalLink?: string
  /** Handles the Solana Pay GET→POST transaction request protocol */
  supportsPaymentRequest: boolean
  /** Can connect via WalletConnect (EVM) */
  supportsWalletConnect: boolean
  /** Injects window.solana or a wallet-standard Solana provider */
  supportsSolanaProvider: boolean
  /**
   * The in-app browser injects a working Solana provider.
   * False = opening via wallet_deep_link routes the user into an EVM/Base context
   * instead of executing the Solana Pay protocol (e.g. Coinbase Wallet).
   */
  mobileInAppBrowserSolanaSupport: boolean
  /** Handles lightning: URI scheme or a wallet-specific invoice scheme */
  supportsLightningInvoice: boolean
  /** Notes visible in simulators / admin tooling only */
  notes?: string
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const PAYMENT_APP_REGISTRY: Record<string, PaymentApp> = {

  // ── Solana wallets ───────────────────────────────────────────────────────────

  phantom: {
    id: "phantom",
    displayName: "Phantom",
    appFamily: "phantom",
    railSupport: ["solana"],
    assetSupport: ["SOL", "USDC"],
    mobileOpenStrategy: "phantom_browser",
    installUrl: "https://phantom.com/download",
    universalLink: "https://phantom.app/ul/browse",
    supportsPaymentRequest: true,
    supportsWalletConnect: false,
    supportsSolanaProvider: true,
    mobileInAppBrowserSolanaSupport: true,
    supportsLightningInvoice: false,
    notes:
      "Uses a Phantom-specific browser URL that reopens this page inside Phantom, injecting window.solana.",
  },

  solflare: {
    id: "solflare",
    displayName: "Solflare",
    appFamily: "solflare",
    railSupport: ["solana"],
    assetSupport: ["SOL", "USDC"],
    mobileOpenStrategy: "solflare_universal",
    installUrl: "https://solflare.com/download",
    universalLink: "https://solflare.com/ul",
    supportsPaymentRequest: true,
    supportsWalletConnect: false,
    supportsSolanaProvider: true,
    mobileInAppBrowserSolanaSupport: true,
    supportsLightningInvoice: false,
    notes: "Uses Solflare Universal Link v1 (connect → signAndSend deeplink protocol).",
  },

  backpack: {
    id: "backpack",
    displayName: "Backpack",
    appFamily: "backpack",
    railSupport: ["solana"],
    assetSupport: ["SOL", "USDC"],
    mobileOpenStrategy: "wallet_deep_link",
    installUrl: "https://backpack.app/download",
    nativeScheme: "backpack://",
    supportsPaymentRequest: true,
    supportsWalletConnect: false,
    supportsSolanaProvider: true,
    mobileInAppBrowserSolanaSupport: true,
    supportsLightningInvoice: false,
  },

  glow: {
    id: "glow",
    displayName: "Glow",
    appFamily: "glow",
    railSupport: ["solana"],
    assetSupport: ["SOL", "USDC"],
    mobileOpenStrategy: "wallet_deep_link",
    installUrl: "https://glow.app",
    nativeScheme: "glow://",
    supportsPaymentRequest: true,
    supportsWalletConnect: false,
    supportsSolanaProvider: true,
    mobileInAppBrowserSolanaSupport: true,
    supportsLightningInvoice: false,
  },

  "trust-wallet": {
    id: "trust-wallet",
    displayName: "Trust Wallet",
    appFamily: "trust",
    railSupport: ["solana", "base"],
    assetSupport: ["SOL", "USDC", "ETH"],
    mobileOpenStrategy: "wallet_deep_link",
    installUrl: "https://trustwallet.com/download",
    universalLink: "https://link.trustwallet.com/open_url",
    supportsPaymentRequest: true,
    supportsWalletConnect: true,
    supportsSolanaProvider: true,
    mobileInAppBrowserSolanaSupport: true,
    supportsLightningInvoice: false,
  },

  "coinbase-wallet": {
    id: "coinbase-wallet",
    displayName: "Coinbase Wallet",
    appFamily: "coinbase_wallet",
    railSupport: ["base"],
    assetSupport: ["ETH", "USDC"],
    mobileOpenStrategy: "walletconnect",
    installUrl: "https://www.coinbase.com/wallet/downloads",
    universalLink: "https://go.cb-w.com/dapp",
    supportsPaymentRequest: false,
    supportsWalletConnect: true,
    supportsSolanaProvider: false,
    mobileInAppBrowserSolanaSupport: false,
    supportsLightningInvoice: false,
    notes:
      "Coinbase Wallet is the self-custody product (separate from the Coinbase exchange app). " +
      "Its in-app browser does NOT inject a Solana provider — it routes into an EVM/Base context. " +
      "Shown as 'Desktop only' for Solana. Supports Base via WalletConnect.",
  },

  "okx-wallet": {
    id: "okx-wallet",
    displayName: "OKX Wallet",
    appFamily: "okx",
    railSupport: ["solana"],
    assetSupport: ["SOL", "USDC"],
    mobileOpenStrategy: "wallet_deep_link",
    installUrl: "https://www.okx.com/web3",
    nativeScheme: "okx://wallet/dapp/url",
    supportsPaymentRequest: true,
    supportsWalletConnect: false,
    supportsSolanaProvider: true,
    mobileInAppBrowserSolanaSupport: true,
    supportsLightningInvoice: false,
  },

  // ── Base / EVM wallets ───────────────────────────────────────────────────────

  metamask: {
    id: "metamask",
    displayName: "MetaMask",
    appFamily: "metamask",
    railSupport: ["base"],
    assetSupport: ["ETH", "USDC"],
    mobileOpenStrategy: "walletconnect",
    installUrl: "https://metamask.io/download",
    supportsPaymentRequest: false,
    supportsWalletConnect: true,
    supportsSolanaProvider: false,
    mobileInAppBrowserSolanaSupport: false,
    supportsLightningInvoice: false,
  },

  rainbow: {
    id: "rainbow",
    displayName: "Rainbow",
    appFamily: "rainbow",
    railSupport: ["base"],
    assetSupport: ["ETH", "USDC"],
    mobileOpenStrategy: "walletconnect",
    installUrl: "https://rainbow.me",
    supportsPaymentRequest: false,
    supportsWalletConnect: true,
    supportsSolanaProvider: false,
    mobileInAppBrowserSolanaSupport: false,
    supportsLightningInvoice: false,
  },

  kraken: {
    id: "kraken",
    displayName: "Kraken",
    appFamily: "kraken",
    railSupport: ["base"],
    assetSupport: ["ETH", "USDC"],
    mobileOpenStrategy: "walletconnect",
    installUrl: "https://www.kraken.com/wallet",
    supportsPaymentRequest: false,
    supportsWalletConnect: true,
    supportsSolanaProvider: false,
    mobileInAppBrowserSolanaSupport: false,
    supportsLightningInvoice: false,
  },

  // ── Lightning / Bitcoin apps ─────────────────────────────────────────────────

  "cash-app": {
    id: "cash-app",
    displayName: "Cash App",
    appFamily: "cash_app",
    railSupport: ["bitcoin_lightning"],
    assetSupport: ["BTC"],
    mobileOpenStrategy: "lightning_uri",
    installUrl: "https://cash.app/download",
    universalLink: "https://cash.app/download",
    nativeScheme: "cashapp://",
    supportsPaymentRequest: false,
    supportsWalletConnect: false,
    supportsSolanaProvider: false,
    mobileInAppBrowserSolanaSupport: false,
    supportsLightningInvoice: true,
    notes:
      "Cash App handles the standard lightning: URI scheme. PineTree navigates to " +
      "lightning:${invoice} and waits 1.4 s; if the page is still visible the " +
      "App Store is offered as a fallback. No wallet-specific deeplink is used.",
  },

  strike: {
    id: "strike",
    displayName: "Strike",
    appFamily: "strike",
    railSupport: ["bitcoin_lightning"],
    assetSupport: ["BTC"],
    mobileOpenStrategy: "lightning_uri",
    installUrl: "https://strike.me/download",
    universalLink: "https://strike.me/download",
    nativeScheme: "strike://",
    supportsPaymentRequest: false,
    supportsWalletConnect: false,
    supportsSolanaProvider: false,
    mobileInAppBrowserSolanaSupport: false,
    supportsLightningInvoice: true,
    notes:
      "Strike handles the standard lightning: URI scheme. Same safe timeout pattern as Cash App.",
  },

  "wallet-of-satoshi": {
    id: "wallet-of-satoshi",
    displayName: "Wallet of Satoshi",
    appFamily: "wallet_of_satoshi",
    railSupport: ["bitcoin_lightning"],
    assetSupport: ["BTC"],
    mobileOpenStrategy: "lightning_uri",
    installUrl: "https://www.walletofsatoshi.com",
    supportsPaymentRequest: false,
    supportsWalletConnect: false,
    supportsSolanaProvider: false,
    mobileInAppBrowserSolanaSupport: false,
    supportsLightningInvoice: true,
  },

  muun: {
    id: "muun",
    displayName: "Muun",
    appFamily: "muun",
    railSupport: ["bitcoin_lightning"],
    assetSupport: ["BTC"],
    mobileOpenStrategy: "lightning_uri",
    installUrl: "https://muun.com",
    supportsPaymentRequest: false,
    supportsWalletConnect: false,
    supportsSolanaProvider: false,
    mobileInAppBrowserSolanaSupport: false,
    supportsLightningInvoice: true,
  },

  phoenix: {
    id: "phoenix",
    displayName: "Phoenix",
    appFamily: "phoenix",
    railSupport: ["bitcoin_lightning"],
    assetSupport: ["BTC"],
    mobileOpenStrategy: "invoice_scheme",
    installUrl: "https://phoenix.acinq.co",
    nativeScheme: "phoenix:",
    supportsPaymentRequest: false,
    supportsWalletConnect: false,
    supportsSolanaProvider: false,
    mobileInAppBrowserSolanaSupport: false,
    supportsLightningInvoice: true,
    notes: "Uses phoenix:lightning:${invoice} URI scheme.",
  },

  zeus: {
    id: "zeus",
    displayName: "Zeus",
    appFamily: "zeus",
    railSupport: ["bitcoin_lightning"],
    assetSupport: ["BTC"],
    mobileOpenStrategy: "invoice_scheme",
    installUrl: "https://zeusln.app",
    nativeScheme: "zeusln:",
    supportsPaymentRequest: false,
    supportsWalletConnect: false,
    supportsSolanaProvider: false,
    mobileInAppBrowserSolanaSupport: false,
    supportsLightningInvoice: true,
    notes: "Uses zeusln:${invoice} URI scheme.",
  },

  breez: {
    id: "breez",
    displayName: "Breez",
    appFamily: "breez",
    railSupport: ["bitcoin_lightning"],
    assetSupport: ["BTC"],
    mobileOpenStrategy: "invoice_scheme",
    installUrl: "https://breez.technology",
    nativeScheme: "breez:",
    supportsPaymentRequest: false,
    supportsWalletConnect: false,
    supportsSolanaProvider: false,
    mobileInAppBrowserSolanaSupport: false,
    supportsLightningInvoice: true,
    notes: "Uses breez:${invoice} URI scheme.",
  },

  bluewallet: {
    id: "bluewallet",
    displayName: "BlueWallet",
    appFamily: "bluewallet",
    railSupport: ["bitcoin_lightning"],
    assetSupport: ["BTC"],
    mobileOpenStrategy: "invoice_scheme",
    installUrl: "https://bluewallet.io",
    nativeScheme: "bluewallet:",
    supportsPaymentRequest: false,
    supportsWalletConnect: false,
    supportsSolanaProvider: false,
    mobileInAppBrowserSolanaSupport: false,
    supportsLightningInvoice: true,
    notes: "Uses bluewallet:lightning:${invoice} URI scheme.",
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** All apps that support a given rail. */
export function getAppsForRail(rail: PaymentRail): PaymentApp[] {
  return Object.values(PAYMENT_APP_REGISTRY).filter((app) =>
    app.railSupport.includes(rail),
  )
}

/** Resolve a registered app by ID. Returns undefined when not found. */
export function getPaymentApp(id: string): PaymentApp | undefined {
  return PAYMENT_APP_REGISTRY[id]
}

/**
 * Derive the customer-facing button action for a Solana wallet on a given platform.
 *
 * Returns one of:
 *   "connect"       — wallet provider detected in this browser, connect directly
 *   "open_app"      — no provider but a mobile deep-link path exists
 *   "desktop_only"  — in-app browser does not inject a Solana provider; mobile unsupported
 *   "install"       — no deep-link path; send to store
 *   "disabled"      — wallet cannot serve this rail
 */
export type SolanaWalletAction = "connect" | "open_app" | "desktop_only" | "install" | "disabled"

export function deriveSolanaWalletAction(input: {
  app: PaymentApp
  providerDetected: boolean
  isMobile: boolean
}): SolanaWalletAction {
  const { app, providerDetected, isMobile } = input
  if (!app.railSupport.includes("solana")) return "disabled"
  if (providerDetected) return "connect"
  if (isMobile && !app.mobileInAppBrowserSolanaSupport) return "desktop_only"
  if (isMobile && app.mobileOpenStrategy !== "none" && app.mobileOpenStrategy !== "walletconnect") {
    return "open_app"
  }
  return "install"
}

/**
 * Derive the customer-facing button action for a Lightning wallet.
 *
 * Returns one of:
 *   "pay_invoice"   — navigate to lightning: or wallet-specific URI (app may be installed)
 *   "install"       — no invoice URI path; send to store
 *   "disabled"      — wallet cannot serve this rail
 */
export type LightningWalletAction = "pay_invoice" | "install" | "disabled"

export function deriveLightningWalletAction(app: PaymentApp): LightningWalletAction {
  if (!app.railSupport.includes("bitcoin_lightning")) return "disabled"
  if (app.supportsLightningInvoice) return "pay_invoice"
  return "install"
}
