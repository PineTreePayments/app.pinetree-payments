export type DynamicSignerRail = "base" | "solana" | "bitcoin"
export type DynamicWalletChain = "solana" | "evm" | "bitcoin" | "unknown"

export type DynamicWalletLike = {
  id?: unknown
  key?: unknown
  address?: string
  publicKey?: unknown
  accountAddress?: string
  accounts?: Array<{ address?: string | null; chain?: unknown; chainName?: unknown; network?: unknown }>
  chain?: unknown
  chainName?: unknown
  connectedChain?: unknown
  network?: unknown
  walletConnector?: {
    key?: string
    name?: string
    chain?: unknown
    chainName?: unknown
    connectedChain?: unknown
    overrideKey?: string
  }
  additionalAddresses?: Array<{ address?: string | null; chain?: unknown; chainName?: unknown; network?: unknown }>
  signAndSendTransaction?: (...args: unknown[]) => Promise<unknown>
  signPsbt?: (request: { unsignedPsbtBase64: string }) => Promise<{ signedPsbt?: string } | undefined>
  connector?: {
    key?: string
    name?: string
    chain?: unknown
    chainName?: unknown
    connectedChain?: unknown
    overrideKey?: string
    activeAccount?: { address?: string | null }
    publicKey?: unknown
    turnkeyAddress?: string | null
    activeAccountAddress?: string | null
    getActiveAddress?: () => string | undefined
    getActiveAccountAddress?: () => string | undefined | Promise<string | undefined>
    getConnectedAccounts?: () => string[] | undefined | Promise<string[] | undefined>
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
  walletChain: DynamicWalletChain
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
    connectorKey: wallet.connector?.key ?? wallet.walletConnector?.key ?? null,
    connectorName: wallet.connector?.name ?? wallet.walletConnector?.name ?? null,
  }
}

function stringifyChainHint(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase()
  if (!value || typeof value !== "object") return ""
  const record = value as Record<string, unknown>
  return [
    record.chain,
    record.name,
    record.key,
    record.network,
    record.namespace,
    record.blockchain,
    record.chainName,
  ].map(stringifyChainHint).filter(Boolean).join(" ")
}

function classifyChainHint(value: unknown): DynamicWalletChain {
  const hint = stringifyChainHint(value)
  if (!hint) return "unknown"
  if (/\b(solana|svm|sol)\b/.test(hint)) return "solana"
  if (/\b(bitcoin|btc|bip122|sats|ordinals|psbt)\b/.test(hint)) return "bitcoin"
  if (/\b(evm|eip155|ethereum|base|polygon|optimism|arbitrum|avalanche|bsc|binance|zerodev|turnkeyevm|wagmi)\b/.test(hint)) {
    return "evm"
  }
  return "unknown"
}

function mergeChainClassifications(values: DynamicWalletChain[]): DynamicWalletChain {
  const known = values.filter((value) => value !== "unknown")
  return new Set(known).size === 1 ? known[0] : "unknown"
}

export function classifyDynamicWalletChain(wallet: DynamicWalletLike): DynamicWalletChain {
  const connectorKeyName = [
    wallet.connector?.key,
    wallet.connector?.name,
    wallet.walletConnector?.key,
    wallet.walletConnector?.name,
  ].filter(Boolean).join(" ")

  return mergeChainClassifications([
    classifyChainHint(wallet.chain),
    classifyChainHint(wallet.chainName),
    classifyChainHint(wallet.connectedChain),
    classifyChainHint(wallet.network),
    classifyChainHint(wallet.connector?.chain),
    classifyChainHint(wallet.connector?.chainName),
    classifyChainHint(wallet.connector?.connectedChain),
    classifyChainHint(wallet.connector?.overrideKey),
    classifyChainHint(wallet.walletConnector?.chain),
    classifyChainHint(wallet.walletConnector?.chainName),
    classifyChainHint(wallet.walletConnector?.connectedChain),
    classifyChainHint(wallet.walletConnector?.overrideKey),
    classifyChainHint(connectorKeyName),
    ...((wallet.accounts ?? []).map((account) =>
      mergeChainClassifications([
        classifyChainHint(account.chain),
        classifyChainHint(account.chainName),
        classifyChainHint(account.network),
      ])
    )),
    ...((wallet.additionalAddresses ?? []).map((entry) =>
      mergeChainClassifications([
        classifyChainHint(entry.chain),
        classifyChainHint(entry.chainName),
        classifyChainHint(entry.network),
      ])
    )),
  ])
}

function expectedChainForRail(rail?: DynamicSignerRail): DynamicWalletChain | null {
  if (rail === "solana") return "solana"
  if (rail === "base") return "evm"
  if (rail === "bitcoin") return "bitcoin"
  return null
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

export async function getDynamicWalletAddressesAsync(wallet: DynamicWalletLike) {
  const connector = wallet.connector
  const { activeAccountAddress, extractedAddressFields } = await extractDynamicActiveWalletAddress(wallet)
  let connectedAccounts: string[] = []
  try {
    const accounts = await connector?.getConnectedAccounts?.()
    connectedAccounts = Array.isArray(accounts) ? accounts : []
  } catch {
    connectedAccounts = []
  }

  const addresses = [
    ...getDynamicWalletAddresses(wallet),
    activeAccountAddress,
    ...Object.values(extractedAddressFields),
    ...connectedAccounts,
  ].flatMap((address) => {
    const normalized = String(address || "").trim()
    return normalized ? [normalized] : []
  })

  return Array.from(new Set(addresses))
}

export function getDynamicWalletSearchList(
  candidates: unknown[],
  primaryWallet: unknown,
  rail?: DynamicSignerRail
): DynamicWalletLike[] {
  const seen = new Set<unknown>()
  const expectedChain = expectedChainForRail(rail)
  return [primaryWallet, ...candidates].filter((wallet) => {
    if (!wallet || seen.has(wallet)) return false
    seen.add(wallet)
    if (expectedChain && classifyDynamicWalletChain(wallet as DynamicWalletLike) !== expectedChain) return false
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
  return getDynamicWalletSearchList(candidates, primaryWallet, rail).find((wallet) =>
    getDynamicWalletAddresses(wallet).some((address) =>
      dynamicWalletAddressesMatch(address, sourceAddress, rail)
    )
  ) || null
}

export function dynamicWalletSupportsRail(wallet: DynamicWalletLike, rail: DynamicSignerRail) {
  const expectedChain = expectedChainForRail(rail)
  if (expectedChain && classifyDynamicWalletChain(wallet) !== expectedChain) return false
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

export async function findDynamicApprovalWalletForSourceAsync(
  candidates: unknown[],
  primaryWallet: unknown,
  rail: DynamicSignerRail,
  sourceAddress: string | null | undefined
) {
  if (!sourceAddress) return null
  for (const wallet of getDynamicWalletSearchList(candidates, primaryWallet, rail)) {
    if (!dynamicWalletSupportsRail(wallet, rail)) continue
    const addresses = await getDynamicWalletAddressesAsync(wallet)
    if (addresses.some((address) => dynamicWalletAddressesMatch(address, sourceAddress, rail))) {
      return wallet
    }
  }
  return null
}

export function assertDynamicWalletChain(wallet: DynamicWalletLike, rail: DynamicSignerRail) {
  const walletChain = classifyDynamicWalletChain(wallet)
  if (rail === "solana" && walletChain !== "solana") {
    throw new Error("Dynamic signer chain mismatch: expected Solana signer.")
  }
  if (rail === "base" && walletChain !== "evm") {
    throw new Error("Dynamic signer chain mismatch: expected EVM signer.")
  }
  if (rail === "bitcoin" && walletChain !== "bitcoin") {
    throw new Error("Dynamic signer chain mismatch: expected Bitcoin signer.")
  }
}

export async function signDynamicSolanaTransactionWithActiveAccount(
  wallet: DynamicWalletLike,
  transaction: unknown,
  sourceAddress: string,
  onDiagnostics?: (diagnostics: DynamicSolanaSignerDiagnostics) => void
) {
  assertDynamicWalletChain(wallet, "solana")
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
    walletChain: classifyDynamicWalletChain(wallet),
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
