export type DynamicSignerRail = "base" | "solana" | "bitcoin"
import bs58 from "bs58"

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
  getSigner?: () => unknown | Promise<unknown>
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
    getSigner?: () => unknown | Promise<unknown>
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

export type DynamicSolanaSignAndSendCapability = {
  connectorKey: string | null
  connectorName: string | null
  connectorType: string | null
  hasSignAndSendTransaction: boolean
  signAndSendTransaction: (transaction: unknown) => Promise<unknown>
}

export const DYNAMIC_SOLANA_SIGN_TIMEOUT_MS = 45_000
export const DYNAMIC_SOLANA_SIGN_TIMEOUT_MESSAGE =
  "Withdrawal approval is still pending. Check your wallet activity before trying again."

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

// Inverse of expectedChainForRail - what withdrawal rail a wallet's classified chain
// actually corresponds to, so callers can compare "what we asked for" against "what
// we got" using the same vocabulary (e.g. in signing preflight diagnostics/logging).
export function railForDynamicWalletChain(chain: DynamicWalletChain): DynamicSignerRail | "unknown" {
  if (chain === "solana") return "solana"
  if (chain === "evm") return "base"
  if (chain === "bitcoin") return "bitcoin"
  return "unknown"
}

export function inferredSignerRailForWallet(wallet: DynamicWalletLike): DynamicSignerRail | "unknown" {
  return railForDynamicWalletChain(classifyDynamicWalletChain(wallet))
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
  if (rail === "solana") return resolveDynamicSolanaSignAndSendCapability(wallet).hasSignAndSendTransaction
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

function summarizeDynamicSolanaSignResult(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (Array.isArray(value)) return `array(${value.length})`
  if (typeof value === "object") return `object(${Object.keys(value as Record<string, unknown>).join(",")})`
  return typeof value
}

function readStringField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function isUint8ArrayLike(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array
}

export function normalizeDynamicSolanaSignature(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null
  if (isUint8ArrayLike(value)) return value.length > 0 ? bs58.encode(value) : null
  if (!value || typeof value !== "object") return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const signature = normalizeDynamicSolanaSignature(item)
      if (signature) return signature
    }
    return null
  }

  const record = value as Record<string, unknown>
  const direct = [
    "signature",
    "txHash",
    "tx_hash",
    "hash",
    "transactionHash",
    "transactionSignature",
    "signedTransaction",
  ].map((key) => readStringField(record, key)).find(Boolean)
  if (direct) return direct

  const signatures = record.signatures
  if (Array.isArray(signatures)) {
    const signature = signatures.find((item): item is string => typeof item === "string" && item.trim().length > 0)
    if (signature) return signature.trim()
  }

  for (const key of ["result", "response", "data"]) {
    const signature = normalizeDynamicSolanaSignature(record[key])
    if (signature) return signature
  }

  return null
}

function maskSignature(value: string | null) {
  if (!value) return null
  return value.length <= 12 ? value : `${value.slice(0, 6)}...${value.slice(-6)}`
}

function safeDiagnosticString(value: unknown, fallback: string | null = null) {
  const text = String(value || "").trim()
  if (!text) return fallback
  return text
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/[A-Za-z0-9+/=]{120,}/g, "[redacted-payload]")
    .slice(0, 500)
}

function dynamicErrorRecord(error: unknown) {
  return error && typeof error === "object" ? error as Record<string, unknown> : null
}

function classifyDynamicSolanaSigningFailure(error: unknown) {
  const record = dynamicErrorRecord(error)
  const name = safeDiagnosticString(record?.name, error instanceof Error ? error.name : null)
  const code = safeDiagnosticString(record?.code, null)
  const message = safeDiagnosticString(error instanceof Error ? error.message : error, null)
  const combined = `${name || ""} ${code || ""} ${message || ""}`.toLowerCase()
  if (message === DYNAMIC_SOLANA_SIGN_TIMEOUT_MESSAGE) return "DYNAMIC_SIGNING_TIMEOUT"
  if (/timeout|timed out/.test(combined)) return "DYNAMIC_SIGNING_TIMEOUT"
  if (/cancel|reject|denied|declin|user rejected|user denied/.test(combined)) return "DYNAMIC_SIGNING_REJECTED"
  if (/not implemented|not expose|not available|signer not found|signer_not_available/.test(combined)) return "SIGNER_NOT_AVAILABLE"
  return code || "DYNAMIC_SIGNING_FAILED"
}

function dynamicSolanaSigningFailureDiagnostics(error: unknown, capability: DynamicSolanaSignAndSendCapability) {
  const record = dynamicErrorRecord(error)
  const response = dynamicErrorRecord(record?.response)
  return {
    errorName: safeDiagnosticString(record?.name, error instanceof Error ? error.name : "Error"),
    errorCode: classifyDynamicSolanaSigningFailure(error),
    sdkCode: safeDiagnosticString(record?.code, null),
    errorMessage: safeDiagnosticString(error instanceof Error ? error.message : error, "Dynamic signing failed."),
    stack: safeDiagnosticString(error instanceof Error ? error.stack : record?.stack, null),
    cause: safeDiagnosticString(record?.cause, null),
    responseStatus: typeof response?.status === "number" ? response.status : null,
    responseStatusText: safeDiagnosticString(response?.statusText, null),
    responseBody: safeDiagnosticString(response?.body ?? response?.data, null),
    connectorKey: capability.connectorKey,
    connectorType: capability.connectorType,
  }
}

function signerMethod(candidate: unknown) {
  if (!candidate || typeof candidate !== "object") return null
  const method = (candidate as { signAndSendTransaction?: unknown }).signAndSendTransaction
  return typeof method === "function" ? method as (...args: unknown[]) => Promise<unknown> : null
}

function candidateConnectorType(value: unknown) {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  return [
    record.key,
    record.name,
    record.chain,
    record.chainName,
    record.connectedChain,
    record.overrideKey,
  ].map((entry) => String(entry || "").trim()).filter(Boolean).join(":").slice(0, 80) || null
}

export function resolveDynamicSolanaSignAndSendCapability(
  wallet: DynamicWalletLike
): DynamicSolanaSignAndSendCapability {
  const connectorInfo = getDynamicWalletConnectorInfo(wallet)
  const walletMethod = signerMethod(wallet)
  if (walletMethod) {
    return {
      ...connectorInfo,
      connectorType: candidateConnectorType(wallet.connector ?? wallet.walletConnector ?? wallet),
      hasSignAndSendTransaction: true,
      signAndSendTransaction: (transaction) =>
        wallet.signAndSendTransaction!(transaction),
    }
  }

  const connectorMethod = signerMethod(wallet.connector)
  if (connectorMethod) {
    return {
      ...connectorInfo,
      connectorType: candidateConnectorType(wallet.connector),
      hasSignAndSendTransaction: true,
      signAndSendTransaction: (transaction) =>
        wallet.connector!.signAndSendTransaction!(transaction),
    }
  }

  const signerFactory = wallet.getSigner ?? wallet.connector?.getSigner
  if (typeof signerFactory === "function") {
    return {
      ...connectorInfo,
      connectorType: candidateConnectorType(wallet.connector ?? wallet),
      hasSignAndSendTransaction: true,
      signAndSendTransaction: async (transaction) => {
        const signer = await signerFactory.call(wallet.getSigner ? wallet : wallet.connector)
        const method = signerMethod(signer)
        if (!method) {
          throw Object.assign(new Error("Dynamic wallet does not expose signAndSendTransaction."), {
            code: "SIGNER_NOT_AVAILABLE",
          })
        }
        return method.call(signer, transaction)
      },
    }
  }

  const walletClientFactory = wallet.getWalletClient ?? wallet.connector?.getWalletClient
  if (typeof walletClientFactory === "function") {
    return {
      ...connectorInfo,
      connectorType: candidateConnectorType(wallet.connector ?? wallet),
      hasSignAndSendTransaction: true,
      signAndSendTransaction: async (transaction) => {
        const client = await walletClientFactory.call(wallet.getWalletClient ? wallet : wallet.connector, "solana")
        const method = signerMethod(client)
        if (!method) {
          throw Object.assign(new Error("Dynamic wallet does not expose signAndSendTransaction."), {
            code: "SIGNER_NOT_AVAILABLE",
          })
        }
        return method.call(client, transaction)
      },
    }
  }

  return {
    ...connectorInfo,
    connectorType: candidateConnectorType(wallet.connector ?? wallet.walletConnector ?? wallet),
    hasSignAndSendTransaction: false,
    signAndSendTransaction: async () => {
      throw Object.assign(new Error("Dynamic wallet does not expose signAndSendTransaction."), {
        code: "SIGNER_NOT_AVAILABLE",
      })
    },
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export async function signDynamicSolanaTransactionWithActiveAccount(
  wallet: DynamicWalletLike,
  transaction: unknown,
  sourceAddress: string,
  onDiagnostics?: (diagnostics: DynamicSolanaSignerDiagnostics) => void,
  onBeforeDynamicModal?: () => void
) {
  assertDynamicWalletChain(wallet, "solana")
  const { activeAccountAddress, extractedAddressFields } = await extractDynamicActiveWalletAddress(wallet)
  const capability = resolveDynamicSolanaSignAndSendCapability(wallet)
  const hasSignAndSendTransaction = capability.hasSignAndSendTransaction
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

  onBeforeDynamicModal?.()
  if (!capability.hasSignAndSendTransaction) {
    throw Object.assign(new Error("Dynamic wallet does not expose signAndSendTransaction."), {
      code: "SIGNER_NOT_AVAILABLE",
    })
  }
  let txResult: unknown
  try {
    const signPromise = capability.signAndSendTransaction(transaction)
    txResult = await withTimeout(
      signPromise,
      DYNAMIC_SOLANA_SIGN_TIMEOUT_MS,
      DYNAMIC_SOLANA_SIGN_TIMEOUT_MESSAGE
    )
  } catch (error) {
    const diagnostics = dynamicSolanaSigningFailureDiagnostics(error, capability)
    console.warn("[pinetree-withdrawals] dynamic_solana_sign_error", diagnostics)
    const classified = error instanceof Error ? error : new Error(String(error || "Dynamic signing failed."))
    throw Object.assign(classified, { code: diagnostics.errorCode })
  }
  const txHash = normalizeDynamicSolanaSignature(txResult)
  console.info("[pinetree-withdrawals] dynamic_solana_sign_result", {
    returned: summarizeDynamicSolanaSignResult(txResult),
    signaturePresent: Boolean(txHash),
    signature: maskSignature(txHash),
    resultType: txResult === null ? "null" : Array.isArray(txResult) ? "array" : typeof txResult,
    connectorKey: capability.connectorKey,
    connectorType: capability.connectorType,
  })
  if (!txResult) {
    console.warn("[pinetree-withdrawals] dynamic_solana_sign_empty_result", {
      returned: summarizeDynamicSolanaSignResult(txResult),
      connectorKey: capability.connectorKey,
      connectorType: capability.connectorType,
    })
    throw Object.assign(new Error("Dynamic returned no transaction signature."), { code: "SIGNATURE_MISSING" })
  }
  if (!txHash) {
    console.warn("[pinetree-withdrawals] dynamic_solana_sign_missing_signature", {
      returned: summarizeDynamicSolanaSignResult(txResult),
      resultType: txResult === null ? "null" : Array.isArray(txResult) ? "array" : typeof txResult,
      connectorKey: capability.connectorKey,
      connectorType: capability.connectorType,
    })
    throw Object.assign(new Error("Dynamic returned no transaction signature."), { code: "SIGNATURE_MISSING" })
  }
  return { txHash, providerReference: txHash, activeAccountAddress }
}
