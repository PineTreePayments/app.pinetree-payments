/**
 * Reads the Bitcoin/Speed platform-fee settlement bookkeeping a payment was
 * created with (see providers/lightning/speedAdapter.ts), for structured
 * diagnostics only. Never infers or upgrades a settlement state - it only
 * reports back exactly what was recorded at invoice-creation time.
 */

export type BitcoinFeeSettlementInfo = {
  feeUsd: number | null
  feeSats: number | null
  feeConversionRateUsd: number | null
  feeSettlementStatus: string | null
  providerReferencePresent: boolean
  applicationFeeTransferId: string | null
  applicationFeeTransferDestinationAccount: string | null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function readNumber(value: unknown): number | null {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

export function extractBitcoinFeeSettlementInfo(paymentMetadata: unknown): BitcoinFeeSettlementInfo {
  const split = readRecord(readRecord(paymentMetadata)?.split)
  const providerMetadata = readRecord(split?.lightningProviderMetadata)

  return {
    feeUsd: readNumber(providerMetadata?.pineTreeFeeAmount),
    feeSats: readNumber(providerMetadata?.platformFeeSats),
    feeConversionRateUsd: readNumber(providerMetadata?.feeConversionRateUsd),
    feeSettlementStatus: typeof providerMetadata?.feeSettlementStatus === "string"
      ? providerMetadata.feeSettlementStatus
      : null,
    providerReferencePresent: Boolean(providerMetadata?.speedPaymentId),
    applicationFeeTransferId: typeof providerMetadata?.applicationFeeTransferId === "string"
      ? providerMetadata.applicationFeeTransferId
      : null,
    applicationFeeTransferDestinationAccount:
      typeof providerMetadata?.applicationFeeTransferDestinationAccount === "string"
        ? providerMetadata.applicationFeeTransferDestinationAccount
        : null,
  }
}
