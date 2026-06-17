export type PaymentAssetDisplay = {
  assetLabel: string | null
  networkLabel: string | null
  amountPaidLabel: string | null
  rateLabel: string | null
  fiatAmountLabel: string | null
}

type LightningProviderMeta = {
  amountSats?: number | null
  btcPriceUsd?: number | null
  [key: string]: unknown
}

type SplitMeta = {
  expectedAmountNative?: number | null
  nativeSymbol?: string | null
  quotePriceUsd?: number | null
  lightningProviderMetadata?: LightningProviderMeta | null
  [key: string]: unknown
}

export type PaymentMetadataForAssetDisplay = {
  selectedAsset?: string | null
  split?: SplitMeta | null
  [key: string]: unknown
}

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
})

function formatRateLabel(assetSymbol: string, priceUsd: number): string {
  return `1 ${assetSymbol} = ${usdFormatter.format(priceUsd)} USD`
}

function formatCryptoAmount(amount: number, symbol: string): string {
  if (symbol === "SOL") return `${parseFloat(amount.toFixed(9))} SOL`
  if (symbol === "ETH") return `${parseFloat(amount.toFixed(8))} ETH`
  if (symbol === "USDC") return `${parseFloat(amount.toFixed(2))} USDC`
  if (symbol === "BTC") return `${parseFloat(amount.toFixed(8))} BTC`
  return `${amount} ${symbol}`
}

function safePositiveNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Derives human-readable asset display fields from a payment's network and metadata.
 * Returns nulls for any field that is not recorded — never fakes amounts or rates.
 */
export function getPaymentAssetDisplay(
  network: string | null | undefined,
  metadata: PaymentMetadataForAssetDisplay | null | undefined,
  grossAmountUsd: number | null | undefined
): PaymentAssetDisplay {
  const normalizedNetwork = String(network || "").toLowerCase().trim()

  const fiatAmountLabel =
    safePositiveNumber(grossAmountUsd) != null
      ? `${usdFormatter.format(Number(grossAmountUsd))} USD`
      : null

  // Cash / Shift4 / unknown — no crypto to show
  if (
    normalizedNetwork === "shift4" ||
    normalizedNetwork === "cash" ||
    !normalizedNetwork
  ) {
    return { assetLabel: null, networkLabel: null, amountPaidLabel: null, rateLabel: null, fiatAmountLabel }
  }

  const split = metadata?.split ?? null

  // Prefer nativeSymbol (stored since this fix), fall back to selectedAsset
  const resolvedAsset = (
    String(split?.nativeSymbol || "").trim().toUpperCase() ||
    String(metadata?.selectedAsset || "").trim().toUpperCase() ||
    null
  )

  // --- Bitcoin Lightning ---
  if (normalizedNetwork === "bitcoin_lightning") {
    const lm = split?.lightningProviderMetadata ?? null
    const amountSats = safePositiveNumber(lm?.amountSats)
    const btcPriceUsd = safePositiveNumber(lm?.btcPriceUsd)

    return {
      assetLabel: "BTC",
      networkLabel: "Bitcoin Lightning",
      amountPaidLabel: amountSats != null
        ? `${amountSats.toLocaleString("en-US")} sats`
        : null,
      rateLabel: btcPriceUsd != null ? formatRateLabel("BTC", btcPriceUsd) : null,
      fiatAmountLabel
    }
  }

  // --- Solana ---
  if (normalizedNetwork === "solana") {
    const asset = resolvedAsset === "USDC" ? "USDC" : resolvedAsset === "SOL" ? "SOL" : null
    if (!asset) {
      return { assetLabel: null, networkLabel: "Solana", amountPaidLabel: null, rateLabel: null, fiatAmountLabel }
    }

    const nativeAmount = safePositiveNumber(split?.expectedAmountNative)
    const amountPaidLabel = nativeAmount != null ? formatCryptoAmount(nativeAmount, asset) : null

    let rateLabel: string | null = null
    if (asset === "USDC") {
      rateLabel = "1 USDC = $1.00 USD"
    } else {
      const qp = safePositiveNumber(split?.quotePriceUsd)
      if (qp != null) rateLabel = formatRateLabel("SOL", qp)
    }

    return { assetLabel: asset, networkLabel: "Solana", amountPaidLabel, rateLabel, fiatAmountLabel }
  }

  // --- Base ---
  if (normalizedNetwork === "base") {
    const asset = resolvedAsset === "USDC" ? "USDC" : resolvedAsset === "ETH" ? "ETH" : null
    if (!asset) {
      return { assetLabel: null, networkLabel: "Base", amountPaidLabel: null, rateLabel: null, fiatAmountLabel }
    }

    const nativeAmount = safePositiveNumber(split?.expectedAmountNative)
    const amountPaidLabel = nativeAmount != null ? formatCryptoAmount(nativeAmount, asset) : null

    let rateLabel: string | null = null
    if (asset === "USDC") {
      rateLabel = "1 USDC = $1.00 USD"
    } else {
      const qp = safePositiveNumber(split?.quotePriceUsd)
      if (qp != null) rateLabel = formatRateLabel("ETH", qp)
    }

    return { assetLabel: asset, networkLabel: "Base", amountPaidLabel, rateLabel, fiatAmountLabel }
  }

  return { assetLabel: null, networkLabel: null, amountPaidLabel: null, rateLabel: null, fiatAmountLabel }
}
