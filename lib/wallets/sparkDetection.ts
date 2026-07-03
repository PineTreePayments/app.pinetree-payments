// All identifiers that classify a wallet as Spark or Lightning.
// Dynamic SDK may surface these in wallet, connector, or address metadata.
export const SPARK_LIGHTNING_TOKENS = [
  "spark",
  "lightspark",
  "lightning",
  "bitcoin-lightning",
  "btc-lightning",
] as const

export type NetworkId = "base" | "solana" | "bitcoin" | "lightning"

export type DynamicAddressMetadata = {
  address?: unknown
  accountAddress?: unknown
  publicKey?: unknown
  addressType?: unknown
  type?: unknown
  chain?: unknown
  chainName?: unknown
  network?: unknown
  label?: unknown
  name?: unknown
  key?: unknown
}

export type DynamicWalletAddressSource = {
  id?: unknown
  key?: unknown
  walletName?: unknown
  walletProvider?: unknown
  chain?: unknown
  chainName?: unknown
  connectedChain?: unknown
  network?: unknown
  address?: unknown
  accountAddress?: unknown
  publicKey?: unknown
  accounts?: DynamicAddressMetadata[]
  connector?: {
    name?: unknown
    key?: unknown
    chain?: unknown
    chainName?: unknown
    connectedChain?: unknown
    network?: unknown
    overrideKey?: unknown
    activeAccount?: { address?: unknown } | null
    activeAccountAddress?: unknown
    publicKey?: unknown
    turnkeyAddress?: unknown
  }
  walletConnector?: {
    name?: unknown
    key?: unknown
    chain?: unknown
    chainName?: unknown
    connectedChain?: unknown
    network?: unknown
    overrideKey?: unknown
  }
  additionalAddresses?: DynamicAddressMetadata[]
}

export type ExtractedWalletAddress = {
  id: string
  address: string
  detail?: string
}

export type ExtractedWalletAddresses = Record<NetworkId, ExtractedWalletAddress[]>

const LIGHTNING_TOKEN_SET = new Set<string>(SPARK_LIGHTNING_TOKENS)

function normalizeIdentityToken(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/^-+|-+$/g, "")
}

function compactIdentityToken(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function metadataFields(metadata: DynamicAddressMetadata | null | undefined) {
  if (!metadata) return []
  return [
    metadata.addressType,
    metadata.type,
    metadata.chain,
    metadata.chainName,
    metadata.network,
    metadata.label,
    metadata.name,
    metadata.key,
  ]
}

function containsSparkLightningToken(values: unknown[]) {
  return values.some((value) => {
    const normalized = normalizeIdentityToken(value)
    const compact = compactIdentityToken(value)
    return SPARK_LIGHTNING_TOKENS.some((token) => {
      const normalizedToken = normalizeIdentityToken(token)
      const compactToken = compactIdentityToken(token)
      return (
        LIGHTNING_TOKEN_SET.has(normalized) ||
        normalized.includes(normalizedToken) ||
        compact.includes(compactToken)
      )
    })
  })
}

function addressDetail(metadata: DynamicAddressMetadata) {
  const value = metadata.addressType ?? metadata.type ?? metadata.label ?? metadata.name ?? metadata.key
  return value ? String(value).replaceAll("_", " ") : undefined
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

export function networkForWallet(
  chain: string,
  key: string,
  connectorName: string,
  connectorKey = "",
  extraIdentityFields: unknown[] = []
): NetworkId | null {
  const identityFields = [chain, key, connectorName, connectorKey, ...extraIdentityFields]
  const identity = identityFields.map((value) => String(value ?? "").toLowerCase()).join(" ")
  if (containsSparkLightningToken(identityFields)) return "lightning"
  if (/\b(sol|svm|solana)\b/.test(identity) || String(chain).toUpperCase() === "SOL") return "solana"
  if (/\b(evm|eip155|ethereum|base)\b/.test(identity) || String(chain).toUpperCase() === "EVM") return "base"
  if (/\b(btc|bitcoin|bip122)\b/.test(identity) || String(chain).toUpperCase() === "BTC") return "bitcoin"
  return null
}

function networkForAddressShape(address: unknown): NetworkId | null {
  const value = String(address ?? "").trim()
  if (/^0x[a-fA-F0-9]{40}$/.test(value)) return "base"
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return "solana"
  return null
}

export function networkForAdditionalAddress(
  metadata: DynamicAddressMetadata,
  parentNetwork: NetworkId | null
): NetworkId | null {
  const fields = metadataFields(metadata)
  if (containsSparkLightningToken(fields)) return "lightning"

  const identity = fields.map((value) => String(value ?? "").toLowerCase()).join(" ")
  if (/\b(sol|svm|solana)\b/.test(identity) || String(metadata.chain ?? "").toUpperCase() === "SOL") return "solana"
  if (/\b(evm|eip155|ethereum|base)\b/.test(identity) || String(metadata.chain ?? "").toUpperCase() === "EVM") return "base"
  if (/\b(btc|bitcoin|bip122)\b/.test(identity) || String(metadata.chain ?? "").toUpperCase() === "BTC") return "bitcoin"
  const addressNetwork = networkForAddressShape(metadata.address)
  if (addressNetwork) return addressNetwork
  return parentNetwork === "lightning" || parentNetwork === "bitcoin" ? parentNetwork : null
}

function pushAddress(
  groups: ExtractedWalletAddresses,
  seen: Set<string>,
  network: NetworkId | null,
  id: string,
  value: unknown,
  detail?: string
) {
  const address = readAddressValue(value)
  if (!network || !address) return
  const key = `${network}:${address}`
  if (seen.has(key)) return
  seen.add(key)
  groups[network].push(detail ? { id, address, detail } : { id, address })
}

export function emptyExtractedWalletAddresses(): ExtractedWalletAddresses {
  return {
    base: [],
    solana: [],
    bitcoin: [],
    lightning: [],
  }
}

export function extractDynamicWalletAddresses(
  wallets: DynamicWalletAddressSource[]
): ExtractedWalletAddresses {
  const groups = emptyExtractedWalletAddresses()
  const seen = new Set<string>()

  for (const wallet of wallets) {
    const walletId = String(wallet.id ?? wallet.key ?? wallet.walletName ?? "wallet")
    const connectorName = String(wallet.connector?.name ?? "")
    const connectorKey = String(wallet.connector?.key ?? "")
    const network = networkForWallet(
      String(wallet.chain ?? ""),
      String(wallet.key ?? wallet.walletName ?? ""),
      connectorName,
      connectorKey,
      [
        wallet.walletName,
        wallet.walletProvider,
        wallet.chainName,
        wallet.connectedChain,
        wallet.network,
        wallet.connector?.chain,
        wallet.connector?.chainName,
        wallet.connector?.connectedChain,
        wallet.connector?.network,
        wallet.connector?.overrideKey,
        wallet.walletConnector?.chain,
        wallet.walletConnector?.chainName,
        wallet.walletConnector?.connectedChain,
        wallet.walletConnector?.network,
        wallet.walletConnector?.overrideKey,
        wallet.walletConnector?.key,
        wallet.walletConnector?.name,
      ]
    )

    const primaryAddress = readAddressValue(wallet.address)
    const primaryAddressNetwork = network ?? networkForAddressShape(primaryAddress)
    pushAddress(groups, seen, primaryAddressNetwork, walletId, primaryAddress)
    pushAddress(groups, seen, network ?? networkForAddressShape(wallet.accountAddress), `${walletId}-account`, wallet.accountAddress)
    pushAddress(groups, seen, network ?? networkForAddressShape(wallet.publicKey), `${walletId}-public-key`, wallet.publicKey)
    pushAddress(groups, seen, network ?? networkForAddressShape(wallet.connector?.activeAccount?.address), `${walletId}-connector-active`, wallet.connector?.activeAccount?.address)
    pushAddress(groups, seen, network ?? networkForAddressShape(wallet.connector?.activeAccountAddress), `${walletId}-connector-active-address`, wallet.connector?.activeAccountAddress)
    pushAddress(groups, seen, network ?? networkForAddressShape(wallet.connector?.publicKey), `${walletId}-connector-public-key`, wallet.connector?.publicKey)
    pushAddress(groups, seen, network ?? networkForAddressShape(wallet.connector?.turnkeyAddress), `${walletId}-connector-turnkey`, wallet.connector?.turnkeyAddress)

    for (const [index, account] of (wallet.accounts ?? []).entries()) {
      const accountAddress = readAddressValue(account.address ?? account.accountAddress ?? account.publicKey)
      const accountNetwork = networkForAdditionalAddress(account, primaryAddressNetwork)
        ?? network
        ?? networkForAddressShape(accountAddress)
      pushAddress(groups, seen, accountNetwork, `${walletId}-account-${index}`, accountAddress)
    }

    for (const [index, extra] of (wallet.additionalAddresses ?? []).entries()) {
      const extraAddress = readAddressValue(extra.address ?? extra.accountAddress ?? extra.publicKey)
      if (!extraAddress) continue
      if (extraAddress === primaryAddress) continue

      const extraNetwork = networkForAdditionalAddress(extra, primaryAddressNetwork)
      if (!extraNetwork) continue

      pushAddress(groups, seen, extraNetwork, `${walletId}-additional-${index}`, extraAddress, addressDetail(extra))
    }
  }

  return groups
}

export function shortAddress(address: string): string {
  if (address.length <= 26) return address
  return `${address.slice(0, 12)}...${address.slice(-10)}`
}
