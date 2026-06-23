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
  addressType?: unknown
  type?: unknown
  chain?: unknown
  network?: unknown
  label?: unknown
  name?: unknown
  key?: unknown
}

export type DynamicWalletAddressSource = {
  id?: unknown
  key?: unknown
  chain?: unknown
  address?: unknown
  connector?: {
    name?: unknown
    key?: unknown
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

export function networkForWallet(
  chain: string,
  key: string,
  connectorName: string,
  connectorKey = ""
): NetworkId | null {
  const identityFields = [chain, key, connectorName, connectorKey]
  const identity = identityFields.map((value) => String(value ?? "").toLowerCase()).join(" ")
  if (containsSparkLightningToken(identityFields)) return "lightning"
  if (String(chain).toUpperCase() === "SOL" || identity.includes("solana")) return "solana"
  if (String(chain).toUpperCase() === "EVM" || identity.includes("ethereum")) return "base"
  if (String(chain).toUpperCase() === "BTC" || identity.includes("bitcoin")) return "bitcoin"
  return null
}

export function networkForAdditionalAddress(
  metadata: DynamicAddressMetadata,
  parentNetwork: NetworkId | null
): NetworkId | null {
  const fields = metadataFields(metadata)
  if (containsSparkLightningToken(fields)) return "lightning"

  const identity = fields.map((value) => String(value ?? "").toLowerCase()).join(" ")
  if (identity.includes("solana") || String(metadata.chain ?? "").toUpperCase() === "SOL") return "solana"
  if (identity.includes("ethereum") || String(metadata.chain ?? "").toUpperCase() === "EVM") return "base"
  if (identity.includes("bitcoin") || String(metadata.chain ?? "").toUpperCase() === "BTC") return "bitcoin"
  return parentNetwork === "lightning" || parentNetwork === "bitcoin" ? parentNetwork : null
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

  for (const wallet of wallets) {
    const walletId = String(wallet.id ?? wallet.key ?? "wallet")
    const connectorName = String(wallet.connector?.name ?? "")
    const connectorKey = String(wallet.connector?.key ?? "")
    const network = networkForWallet(
      String(wallet.chain ?? ""),
      String(wallet.key ?? ""),
      connectorName,
      connectorKey
    )

    if (network && typeof wallet.address === "string" && wallet.address.trim()) {
      groups[network].push({ id: walletId, address: wallet.address.trim() })
    }

    for (const [index, extra] of (wallet.additionalAddresses ?? []).entries()) {
      if (typeof extra.address !== "string" || !extra.address.trim()) continue
      if (extra.address === wallet.address) continue

      const extraNetwork = networkForAdditionalAddress(extra, network)
      if (!extraNetwork) continue

      groups[extraNetwork].push({
        id: `${walletId}-additional-${index}`,
        address: extra.address.trim(),
        detail: addressDetail(extra),
      })
    }
  }

  return groups
}

export function shortAddress(address: string): string {
  if (address.length <= 26) return address
  return `${address.slice(0, 12)}...${address.slice(-10)}`
}
