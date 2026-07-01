export type DynamicSignerRail = "base" | "solana" | "bitcoin"

export type DynamicWalletLike = {
  address?: string
  chain?: string
  additionalAddresses?: Array<{ address?: string | null }>
  signAndSendTransaction?: (...args: unknown[]) => Promise<unknown>
  signPsbt?: (request: { unsignedPsbtBase64: string }) => Promise<{ signedPsbt?: string } | undefined>
  connector?: {
    getWalletClient?: (chainId?: string | number) => unknown | Promise<unknown>
    signAndSendTransaction?: (...args: unknown[]) => Promise<unknown>
    signPsbt?: (request: { unsignedPsbtBase64: string }) => Promise<{ signedPsbt?: string } | undefined>
  }
  getWalletClient?: (chainId?: string | number) => unknown | Promise<unknown>
}

function normalizeWalletAddress(value: string, rail?: DynamicSignerRail) {
  const address = value.trim()
  if (rail === "base") return address.toLowerCase()
  return address
}

export function getDynamicWalletAddresses(wallet: DynamicWalletLike) {
  return [
    wallet.address,
    ...(wallet.additionalAddresses ?? []).map((entry) => entry.address),
  ].flatMap((address) => {
    const normalized = String(address || "").trim()
    return normalized ? [normalized] : []
  })
}

export function getDynamicWalletSearchList(
  candidates: unknown[],
  primaryWallet: unknown
): DynamicWalletLike[] {
  const seen = new Set<unknown>()
  return [primaryWallet, ...candidates].filter((wallet) => {
    if (!wallet || seen.has(wallet)) return false
    seen.add(wallet)
    return true
  }) as DynamicWalletLike[]
}

export function findDynamicWalletForSource(
  candidates: unknown[],
  primaryWallet: unknown,
  sourceAddress: string,
  rail?: DynamicSignerRail
): DynamicWalletLike | null {
  const normalizedSource = normalizeWalletAddress(sourceAddress, rail)
  if (!normalizedSource) return null
  return getDynamicWalletSearchList(candidates, primaryWallet).find((wallet) =>
    getDynamicWalletAddresses(wallet).some((address) =>
      normalizeWalletAddress(address, rail) === normalizedSource
    )
  ) || null
}

export function dynamicWalletSupportsRail(wallet: DynamicWalletLike, rail: DynamicSignerRail) {
  if (rail === "base") return Boolean(wallet.getWalletClient || wallet.connector?.getWalletClient)
  if (rail === "solana") return Boolean(wallet.signAndSendTransaction || wallet.connector?.signAndSendTransaction)
  return Boolean(wallet.signPsbt || wallet.connector?.signPsbt)
}

export function findDynamicApprovalWalletForSource(
  candidates: unknown[],
  primaryWallet: unknown,
  rail: DynamicSignerRail,
  sourceAddress: string | null | undefined
) {
  if (!sourceAddress) return null
  const wallet = findDynamicWalletForSource(candidates, primaryWallet, sourceAddress, rail)
  return wallet && dynamicWalletSupportsRail(wallet, rail) ? wallet : null
}
