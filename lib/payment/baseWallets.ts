/**
 * Centralized Base (EVM) WalletConnect wallet catalog.
 *
 * Each entry defines the wallet ID, display label, icon asset path, a
 * WalletConnect v2 deep-link builder, and optional metadata.
 *
 * Deep links use HTTPS universal links (https://) wherever the wallet
 * publishes one — they open the app on mobile and fall back to the
 * store/install page when the app is absent. Custom schemes (app://)
 * are used only for wallets without a documented HTTPS alternative.
 *
 * Add / remove wallets here only. Do not scatter wallet hrefs or icon
 * paths through JSX.
 *
 * Set `enabled: false` to hide a wallet from the selector without
 * deleting it from the catalog.
 */

export type BaseWalletEntry = {
  id: string
  label: string
  /** Path relative to /public — served as a static asset */
  iconPath: string
  /** Build the WalletConnect v2 deep link from a pairing URI string */
  href: (uri: string) => string
  /** App store / install fallback when wallet is not installed */
  installUrl?: string
  /** Set false to hide from the wallet selector until tested/verified */
  enabled?: boolean
  /** Brief developer note — compatibility caveats or link source */
  notes?: string
}

const BASE_WALLETS: BaseWalletEntry[] = [
  // ─── Tier 1 — HTTPS universal links, highest reliability ───────────────────

  {
    id: "metamask",
    label: "MetaMask",
    iconPath: "/wallet-icons/metamask.svg",
    href: (uri) => `https://metamask.app.link/wc?uri=${encodeURIComponent(uri)}`,
    installUrl: "https://metamask.io/download",
    enabled: true,
    notes: "Official HTTPS universal link. Opens app or redirects to install.",
  },
  {
    id: "coinbase",
    label: "Coinbase Wallet",
    iconPath: "/wallet-icons/coinbase-wallet.svg",
    href: (uri) => `https://go.cb-w.com/wc?uri=${encodeURIComponent(uri)}`,
    installUrl: "https://www.coinbase.com/wallet",
    enabled: true,
    notes: "Official HTTPS universal link.",
  },
  {
    id: "trust",
    label: "Trust Wallet",
    iconPath: "/wallet-icons/trust-wallet.svg",
    href: (uri) => `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}`,
    installUrl: "https://trustwallet.com/download",
    enabled: true,
    notes: "Official HTTPS universal link.",
  },
  {
    id: "rainbow",
    label: "Rainbow",
    iconPath: "/wallet-icons/rainbow.svg",
    href: (uri) => `https://rnbwapp.com/wc?uri=${encodeURIComponent(uri)}`,
    installUrl: "https://rainbow.me",
    enabled: true,
    notes: "Official HTTPS universal link.",
  },

  // ─── Tier 2 — Custom scheme or app-registered universal link ───────────────

  {
    id: "phantom",
    label: "Phantom",
    iconPath: "/wallet-icons/phantom.svg",
    href: (uri) => `https://phantom.app/wc?uri=${encodeURIComponent(uri)}`,
    installUrl: "https://phantom.app",
    enabled: true,
    notes: "HTTPS universal link. Phantom supports EVM/Base via WalletConnect v2.",
  },
  {
    id: "okx",
    label: "OKX Wallet",
    iconPath: "/wallet-icons/okx-wallet.png",
    href: (uri) => `okx://wallet/wc?uri=${encodeURIComponent(uri)}`,
    installUrl: "https://www.okx.com/web3",
    enabled: true,
    notes: "Custom scheme — opens OKX Wallet if installed.",
  },
  {
    id: "zerion",
    label: "Zerion",
    iconPath: "/wallet-icons/zerion.svg",
    href: (uri) => `zerion://wc?uri=${encodeURIComponent(uri)}`,
    installUrl: "https://zerion.io",
    enabled: true,
    notes: "Custom scheme — Zerion natively supports Base.",
  },
  {
    id: "uniswap",
    label: "Uniswap Wallet",
    iconPath: "/wallet-icons/uniswap-wallet.svg",
    href: (uri) => `uniswap://wc?uri=${encodeURIComponent(uri)}`,
    installUrl: "https://wallet.uniswap.org",
    enabled: true,
    notes: "Custom scheme — Uniswap Wallet natively supports Base.",
  },

  // ─── Tier 3 — Broad EVM support, verified WC v2 ────────────────────────────

  {
    id: "bitget",
    label: "Bitget Wallet",
    iconPath: "/wallet-icons/bitget-wallet.svg",
    href: (uri) => `https://bkcode.vip?action=dapp&url=${encodeURIComponent(`wc?uri=${uri}`)}`,
    installUrl: "https://web3.bitget.com",
    enabled: true,
    notes: "Bitget Wallet (formerly BitKeep). bkcode.vip is their official redirect service; set enabled:false if this link proves unreliable in production.",
  },
  {
    id: "exodus",
    label: "Exodus",
    iconPath: "/wallet-icons/exodus.svg",
    href: (uri) => `exodus://wc?uri=${encodeURIComponent(uri)}`,
    installUrl: "https://www.exodus.com/download",
    enabled: true,
    notes: "Custom scheme — Exodus mobile supports EVM WalletConnect.",
  },
]

export default BASE_WALLETS
