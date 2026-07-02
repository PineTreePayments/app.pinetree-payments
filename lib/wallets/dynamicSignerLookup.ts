export type DynamicSignerRail = "base" | "solana" | "bitcoin"

export type DynamicWalletLike = {
  address?: string
  publicKey?: unknown
  accountAddress?: string
  accounts?: Array<{ address?: string | null }>
  chain?: string
  additionalAddresses?: Array<{ address?: string | null }>
  signAndSendTransaction?: (...args: unknown[]) => Promise<unknown>
  signPsbt?: (request: { unsignedPsbtBase64: string }) => Promise<{ signedPsbt?: string } | undefined>
  connector?: {
    key?: string
    name?: string
    activeAccount?: { address?: string | null }
    publicKey?: unknown
    turnkeyAddress?: string | null
    activeAccountAddress?: string | null
    getActiveAddress?: () => string | undefined
    getActiveAccountAddress?: () => string | undefined | Promise<string | undefined>
    getPublicKey?: () => unknown | Promise<unknown>
    getAddress?: () => string | undefined | Promise<string | undefined>
    getWalletClientByAddress?: (request: { accountAddress: string }) => unknown
    getWalletClient?: (chainId?: string | number) => unknown | Promise<unknown>
    signAndSendTransaction?: (...args: unknown[]) => Promise<unknown>
    signPsbt?: (request: { unsignedPsbtBase64: string }) => Promise<{ signedPsbt?: string } | undefined>
  }
  getWalletClient?: (chainId?: string | number) => unknown | Promise<unknown>
}

export type DynamicWalletAddressDiagnostics = {
  walletAddress: string | null
  walletPublicKey: string | null
  walletAccountAddress: string | null
  walletAccountsFirstAddress: string | null
  connectorActiveAccountAddress: string | null
  connectorPublicKey: string | null
  connectorTurnkeyAddress: string | null
  connectorActiveAccountAddressProperty: string | null
  connectorGetActiveAddress: string | null
  connectorGetActiveAccountAddress: string | null
  connectorGetPublicKey: string | null
  connectorGetAddress: string | null
}

export type DynamicSolanaSignerDiagnostics = {
  connectorKey: string | null
  connectorName: string | null
  extractedAddressFields: DynamicWalletAddressDiagnostics
  sourceAddress: string
  activeAccountAddress: string | null
  activeAccountMatchesSource: boolean
  hasSignAndSendTransaction: boolean
}

function normalizeWalletAddress(value: string, rail?: DynamicSignerRail) {
  const address = value.trim()
  if (rail === "base") return address.toLowerCase()
  return address
}

function readAddressValue(value: unknown): string | null {
  if (typeof value === "string") {
    const address = value.trim()
    return address || null
  }

  if (!value || typeof value !== "object") return null

  const record = value as Record<string, unknown>
  if (typeof record.address === "string") return readAddressValue(record.address)
  if (typeof record.accountAddress === "string") return readAddressValue(record.accountAddress)
  if (typeof record.publicKey === "string") return readAddressValue(record.publicKey)

  const toBase58 = record.toBase58
  if (typeof toBase58 === "function") {
    try {
      return readAddressValue(toBase58.call(value))
    } catch {
      return null
    }
  }

  const toString = record.toString
  if (typeof toString === "function" && toString !== Object.prototype.toString) {
    try {
      const stringValue = toString.call(value)
      if (stringValue !== "[object Object]") return readAddressValue(stringValue)
    } catch {
      return null
    }
  }

  return null
}

async function readAsyncAddressValue(read: (() => unknown | Promise<unknown>) | undefined) {
  if (!read) return null
  try {
    return readAddressValue(await read())
  } catch {
    return null
  }
}

function readSyncAddressValue(read: (() => unknown) | undefined) {
  if (!read) return null
  try {
    return readAddressValue(read())
  } catch {
    return null
  }
}

export function dynamicWalletAddressesMatch(
  candidate: string | null | undefined,
  sourceAddress: string | null | undefined,
  rail?: DynamicSignerRail
) {
  const normalizedCandidate = normalizeWalletAddress(String(candidate || ""), rail)
  const normalizedSource = normalizeWalletAddress(String(sourceAddress || ""), rail)
  return Boolean(normalizedCandidate && normalizedSource && normalizedCandidate === normalizedSource)
}

export function getDynamicWalletConnectorInfo(wallet: DynamicWalletLike) {
  return {
    connectorKey: wallet.connector?.key ?? null,
    connectorName: wallet.connector?.name ?? null,
  }
}

export function getDynamicWalletAddresses(wallet: DynamicWalletLike) {
  return [
    wallet.address,
    readAddressValue(wallet.publicKey),
    wallet.accountAddress,
    wallet.accounts?.[0]?.address,
    wallet.connector?.activeAccount?.address,
    readAddressValue(wallet.connector?.publicKey),
    wallet.connector?.turnkeyAddress,
    wallet.connector?.activeAccountAddress,
    readSyncAddressValue(wallet.connector?.getActiveAddress),
    ...(wallet.additionalAddresses ?? []).map((entry) => entry.address),
  ].flatMap((address) => {
    const normalized = String(address || "").trim()
    return normalized ? [normalized] : []
  })
}

export async function extractDynamicActiveWalletAddress(wallet: DynamicWalletLike) {
  const connector = wallet.connector
  const extractedAddressFields: DynamicWalletAddressDiagnostics = {
    walletAddress: readAddressValue(wallet.address),
    walletPublicKey: readAddressValue(wallet.publicKey),
    walletAccountAddress: readAddressValue(wallet.accountAddress),
    walletAccountsFirstAddress: readAddressValue(wallet.accounts?.[0]?.address),
    connectorActiveAccountAddress: readAddressValue(connector?.activeAccount?.address),
    connectorPublicKey: readAddressValue(connector?.publicKey),
    connectorTurnkeyAddress: readAddressValue(connector?.turnkeyAddress),
    connectorActiveAccountAddressProperty: readAddressValue(connector?.activeAccountAddress),
    connectorGetActiveAddress: readSyncAddressValue(connector?.getActiveAddress),
    connectorGetActiveAccountAddress: await readAsyncAddressValue(connector?.getActiveAccountAddress),
    connectorGetPublicKey: await readAsyncAddressValue(connector?.getPublicKey),
    connectorGetAddress: await readAsyncAddressValue(connector?.getAddress),
  }

  const activeAccountAddress = [
    extractedAddressFields.connectorGetActiveAddress,
    extractedAddressFields.connectorGetActiveAccountAddress,
    extractedAddressFields.connectorActiveAccountAddress,
    extractedAddressFields.connectorActiveAccountAddressProperty,
    extractedAddressFields.connectorTurnkeyAddress,
    extractedAddressFields.walletAccountAddress,
    extractedAddressFields.walletAccountsFirstAddress,
    extractedAddressFields.walletAddress,
    extractedAddressFields.walletPublicKey,
    extractedAddressFields.connectorPublicKey,
    extractedAddressFields.connectorGetPublicKey,
    extractedAddressFields.connectorGetAddress,
  ].find(Boolean) ?? null

  return {
    activeAccountAddress,
    extractedAddressFields,
  }
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
  if (!sourceAddress.trim()) return null
  return getDynamicWalletSearchList(candidates, primaryWallet).find((wallet) =>
    getDynamicWalletAddresses(wallet).some((address) =>
      dynamicWalletAddressesMatch(address, sourceAddress, rail)
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

export async function signDynamicSolanaTransactionWithActiveAccount(
  wallet: DynamicWalletLike,
  transaction: unknown,
  sourceAddress: string,
  onDiagnostics?: (diagnostics: DynamicSolanaSignerDiagnostics) => void
) {
  const { activeAccountAddress, extractedAddressFields } = await extractDynamicActiveWalletAddress(wallet)
  const hasSignAndSendTransaction = Boolean(
    wallet.signAndSendTransaction || wallet.connector?.signAndSendTransaction
  )
  const activeAccountMatchesSource = dynamicWalletAddressesMatch(
    activeAccountAddress,
    sourceAddress,
    "solana"
  )

  onDiagnostics?.({
    ...getDynamicWalletConnectorInfo(wallet),
    extractedAddressFields,
    sourceAddress,
    activeAccountAddress,
    activeAccountMatchesSource,
    hasSignAndSendTransaction,
  })

  if (!activeAccountAddress) {
    throw new Error("Dynamic Solana wallet is connected, but no active Solana account address was available.")
  }

  if (!activeAccountMatchesSource) {
    throw new Error("Dynamic Solana wallet active account does not match the PineTree Wallet source address.")
  }

  wallet.connector?.getWalletClientByAddress?.({ accountAddress: activeAccountAddress })

  const signOptions = {
    accountAddress: activeAccountAddress,
    address: activeAccountAddress,
    publicKey: activeAccountAddress,
  }
  const txResult = await wallet.signAndSendTransaction?.(transaction, signOptions) as unknown
    ?? await wallet.connector?.signAndSendTransaction?.(transaction, signOptions) as unknown
  if (!txResult) {
    throw new Error("Unable to sign this withdrawal. Please try again.")
  }
  const txHash = typeof txResult === "string"
    ? txResult
    : (txResult as { signature?: string }).signature
  if (!txHash) {
    throw new Error("Unable to sign this withdrawal. Please try again.")
  }
  return { txHash, providerReference: txHash, activeAccountAddress }
}
