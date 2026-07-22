export type SpeedWithdrawalMethod = "lightning" | "onchain"

function readNonNegativeIntegerEnv(name: string): bigint | null {
  const value = String(process.env[name] || "").trim()
  if (!/^\d+$/.test(value)) return null
  return BigInt(value)
}

export function getSpeedWithdrawalFeeReserveSats(method: SpeedWithdrawalMethod = "lightning"): bigint {
  const shared = readNonNegativeIntegerEnv("SPEED_WITHDRAWAL_FEE_BUFFER_SATS")
  if (method === "onchain") {
    return readNonNegativeIntegerEnv("SPEED_ONCHAIN_WITHDRAWAL_FEE_BUFFER_SATS") ?? shared ?? BigInt(1_000)
  }
  return readNonNegativeIntegerEnv("SPEED_LIGHTNING_WITHDRAWAL_FEE_BUFFER_SATS") ?? shared ?? BigInt(500)
}

export function calculateSpeedMaximumSendableSats(input: {
  providerAvailableSats: bigint
  pendingSats?: bigint
  method?: SpeedWithdrawalMethod
}): {
  totalAvailableSats: bigint
  pendingSats: bigint
  estimatedFeeSats: bigint
  maximumSendableSats: bigint
} {
  const totalAvailableSats = input.providerAvailableSats > BigInt(0) ? input.providerAvailableSats : BigInt(0)
  const pendingSats = input.pendingSats && input.pendingSats > BigInt(0) ? input.pendingSats : BigInt(0)
  const estimatedFeeSats = getSpeedWithdrawalFeeReserveSats(input.method ?? "lightning")
  const maximumSendableSats = totalAvailableSats - pendingSats - estimatedFeeSats
  return {
    totalAvailableSats,
    pendingSats,
    estimatedFeeSats,
    maximumSendableSats: maximumSendableSats > BigInt(0) ? maximumSendableSats : BigInt(0),
  }
}

export function speedAmountFitsAvailable(input: {
  amountSats: bigint
  providerAvailableSats: bigint
  pendingSats?: bigint
  method?: SpeedWithdrawalMethod
}) {
  const quote = calculateSpeedMaximumSendableSats({
    providerAvailableSats: input.providerAvailableSats,
    pendingSats: input.pendingSats,
    method: input.method,
  })
  return {
    ...quote,
    fits: input.amountSats > BigInt(0) && input.amountSats <= quote.maximumSendableSats,
  }
}
