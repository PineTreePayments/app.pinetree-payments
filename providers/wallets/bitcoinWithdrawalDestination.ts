import {
  getConfiguredBitcoinNetworkName,
  validateBitcoinAddressForConfiguredNetwork,
} from "@/providers/wallets/bitcoinNetworkProvider"

/**
 * Classifies a merchant-entered Bitcoin withdrawal destination into exactly
 * one of the two supported PineTree withdrawal methods. Bitcoin remains a
 * single asset (BTC) throughout PineTree - "onchain" vs "lightning" is a
 * destination/method distinction only, never a second asset.
 */
export type BitcoinWithdrawalMethod = "onchain" | "lightning"
export type BitcoinDestinationKind = "bitcoin_address" | "lightning_address" | "bolt11_invoice"

export type ClassifiedBitcoinDestination =
  | {
      valid: true
      method: BitcoinWithdrawalMethod
      kind: BitcoinDestinationKind
      normalized: string
    }
  | {
      valid: false
      reason: string
    }

const LIGHTNING_ADDRESS_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i
const BOLT11_CHARSET = /^[a-z0-9]+$/

function bolt11ExpectedPrefix(): string {
  return getConfiguredBitcoinNetworkName() === "testnet" ? "lntb" : "lnbc"
}

function looksLikeBolt11(value: string): boolean {
  const lower = value.trim().toLowerCase()
  // Bech32-style Lightning invoice: hrp ("lnbc"/"lntb" + optional amount) + "1" separator + data part.
  if (!lower.startsWith("ln")) return false
  const separatorIndex = lower.lastIndexOf("1")
  if (separatorIndex < 2 || separatorIndex === lower.length - 1) return false
  const humanReadablePart = lower.slice(0, separatorIndex)
  const dataPart = lower.slice(separatorIndex + 1)
  if (!humanReadablePart.startsWith("lnbc") && !humanReadablePart.startsWith("lntb")) return false
  if (!BOLT11_CHARSET.test(dataPart) || dataPart.length < 20) return false
  return true
}

function bolt11MatchesConfiguredNetwork(value: string): boolean {
  const lower = value.trim().toLowerCase()
  return lower.startsWith(bolt11ExpectedPrefix())
}

/**
 * Classifies a raw merchant-entered string as a validated on-chain Bitcoin
 * address, a Lightning Address, or a BOLT11 invoice. Never accepts a value
 * that is ambiguous or malformed for any of the three supported shapes -
 * an invalid input always returns { valid: false }, never a best guess.
 */
export function classifyBitcoinWithdrawalDestination(raw: string): ClassifiedBitcoinDestination {
  const value = String(raw || "").trim()
  if (!value) return { valid: false, reason: "Destination is required." }

  if (validateBitcoinAddressForConfiguredNetwork(value)) {
    return { valid: true, method: "onchain", kind: "bitcoin_address", normalized: value }
  }

  if (looksLikeBolt11(value)) {
    if (!bolt11MatchesConfiguredNetwork(value)) {
      return { valid: false, reason: "This Lightning invoice is for the wrong Bitcoin network." }
    }
    return { valid: true, method: "lightning", kind: "bolt11_invoice", normalized: value.toLowerCase() }
  }

  if (LIGHTNING_ADDRESS_PATTERN.test(value) && value.length <= 254) {
    return { valid: true, method: "lightning", kind: "lightning_address", normalized: value.toLowerCase() }
  }

  return { valid: false, reason: "Enter a valid Bitcoin address, Lightning Address, or Lightning invoice." }
}

export function isValidBitcoinWithdrawalDestination(raw: string): boolean {
  return classifyBitcoinWithdrawalDestination(raw).valid
}
