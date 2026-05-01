export type SolanaBrowserProvider = {
  isPhantom?: boolean
  isSolflare?: boolean
  publicKey?: { toString: () => string }
  providers?: SolanaBrowserProvider[]
  connect: () => Promise<unknown>
  signAndSendTransaction: (transaction: unknown) => Promise<{ signature?: string } | string>
}

type SolanaBrowserWindow = Window & {
  solana?: SolanaBrowserProvider
  phantom?: { solana?: SolanaBrowserProvider }
  solflare?: SolanaBrowserProvider
}

function getSolanaWindow(): SolanaBrowserWindow | null {
  if (typeof window === "undefined") return null
  return window as SolanaBrowserWindow
}

export function isMobileBrowser(userAgent?: string): boolean {
  const ua = userAgent ?? (typeof navigator === "undefined" ? "" : navigator.userAgent)
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
}

export function getInjectedPhantomProvider(): SolanaBrowserProvider | null {
  const w = getSolanaWindow()
  if (!w) return null

  const candidates = [
    w.phantom?.solana,
    w.solana,
    ...(w.phantom?.solana?.providers ?? []),
    ...(w.solana?.providers ?? []),
  ]

  return candidates.find((provider) => provider?.isPhantom === true) ?? null
}

export function getSolanaProviderPublicKey(
  provider: SolanaBrowserProvider,
  connectResult: unknown,
): string {
  const connectedPublicKey = (connectResult as { publicKey?: { toString: () => string } } | null)?.publicKey?.toString()
  return String(connectedPublicKey || provider.publicKey?.toString() || "").trim()
}

export function getSolanaTransactionSignature(result: { signature?: string } | string): string {
  return String(typeof result === "string" ? result : result.signature || "").trim()
}

export function buildPhantomWalletBrowserUrl(input: {
  currentHref: string
  paymentId: string
}): string {
  const targetUrl = new URL(input.currentHref)
  targetUrl.searchParams.set("mode", "wallet-browser")
  targetUrl.searchParams.set("wallet", "phantom")
  targetUrl.searchParams.set("pinetree_payment_id", input.paymentId)
  targetUrl.searchParams.delete("status")
  targetUrl.searchParams.delete("phantom_error")
  targetUrl.searchParams.delete("solflare_error")

  return `phantom://browse/${encodeURIComponent(targetUrl.toString())}`
}