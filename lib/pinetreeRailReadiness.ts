export type PineTreeRail = "solana" | "base" | "bitcoin_lightning"

export type PineTreeRailReasonCode =
  | "provider_disabled"
  | "provider_not_connected"
  | "missing_wallet_profile"
  | "missing_solana_address"
  | "missing_base_address"
  | "missing_speed_account"
  | "missing_business_profile"
  | "missing_dynamic_signer"
  | "btc_placeholder_only"
  | "ready"

export type PineTreeProviderReadinessInput = {
  provider?: string | null
  enabled?: boolean | null
  status?: string | null
  credentials?: unknown
}

export type PineTreeWalletProfileReadinessInput = {
  solana_address?: string | null
  base_address?: string | null
  btc_address?: string | null
  bitcoin_onchain_address?: string | null
  bitcoin_lightning_address?: string | null
  btc_payout_enabled?: boolean | null
}

export type PineTreeSpeedReadinessInput = {
  configured?: boolean | null
  accountReady?: boolean | null
  payoutReady?: boolean | null
  status?: string | null
}

export type PineTreeDynamicSignerReadinessInput = {
  solana?: boolean | null
  base?: boolean | null
}

export type PineTreeRailReadiness = {
  rail: PineTreeRail
  enabled: boolean
  walletProvisioned: boolean
  paymentReady: boolean
  withdrawalReady: boolean
  reasonCodes: PineTreeRailReasonCode[]
  sourceFields: Record<string, boolean | string | null>
}

export type PineTreeRailReadinessMap = Record<PineTreeRail, PineTreeRailReadiness>

export type BuildPineTreeRailReadinessInput = {
  providers?: PineTreeProviderReadinessInput[]
  walletProfile?: PineTreeWalletProfileReadinessInput | null
  speed?: PineTreeSpeedReadinessInput | null
  dynamicSigners?: PineTreeDynamicSignerReadinessInput | null
  businessProfileComplete?: boolean | null
}

function normalizeProviderId(provider?: string | null) {
  return String(provider || "").toLowerCase().trim()
}

function isTruthyAddress(value?: string | null) {
  return Boolean(String(value || "").trim())
}

function providerRow(
  providers: PineTreeProviderReadinessInput[] | undefined,
  providerId: string
) {
  return (providers || []).find((provider) => normalizeProviderId(provider.provider) === providerId)
}

function providerEnabled(
  providers: PineTreeProviderReadinessInput[] | undefined,
  providerId: string
) {
  const row = providerRow(providers, providerId)
  return Boolean(row?.enabled === true)
}

function providerConnected(
  providers: PineTreeProviderReadinessInput[] | undefined,
  providerId: string
) {
  const row = providerRow(providers, providerId)
  const status = String(row?.status || "").toLowerCase().trim()
  return status === "connected" || status === "active"
}

function withReadyReason(ready: boolean, reasons: PineTreeRailReasonCode[]) {
  return ready ? ["ready"] as PineTreeRailReasonCode[] : reasons
}

export function buildPineTreeRailReadiness(
  input: BuildPineTreeRailReadinessInput
): PineTreeRailReadinessMap {
  const profile = input.walletProfile || null
  const speed = input.speed || null
  const dynamicSigners = input.dynamicSigners || null
  const hasProfile = Boolean(profile)
  const businessProfileComplete = input.businessProfileComplete !== false

  const solanaEnabled = providerEnabled(input.providers, "solana")
  const baseEnabled = providerEnabled(input.providers, "base")
  const lightningEnabled = providerEnabled(input.providers, "lightning_speed")
  const solanaConnected = providerConnected(input.providers, "solana")
  const baseConnected = providerConnected(input.providers, "base")
  const lightningConnected = providerConnected(input.providers, "lightning_speed")

  const solanaAddressPresent = isTruthyAddress(profile?.solana_address)
  const baseAddressPresent = isTruthyAddress(profile?.base_address)
  const btcAddressPresent = isTruthyAddress(profile?.btc_address)
  const bitcoinOnchainAddressPresent = isTruthyAddress(profile?.bitcoin_onchain_address)
  const bitcoinLightningAddressPresent = isTruthyAddress(profile?.bitcoin_lightning_address)
  const speedAccountReady = Boolean(speed?.configured && speed?.accountReady)
  const speedPayoutReady = Boolean(speedAccountReady && speed?.payoutReady)

  const solanaPaymentReady = businessProfileComplete && solanaEnabled && solanaConnected && solanaAddressPresent
  const basePaymentReady = businessProfileComplete && baseEnabled && baseConnected && baseAddressPresent
  const lightningPaymentReady = businessProfileComplete && lightningEnabled && lightningConnected && speedAccountReady

  const solanaWithdrawalReady = solanaPaymentReady && Boolean(dynamicSigners?.solana)
  const baseWithdrawalReady = basePaymentReady && Boolean(dynamicSigners?.base)
  const lightningWithdrawalReady = lightningEnabled && speedPayoutReady

  const solanaReasons: PineTreeRailReasonCode[] = []
  if (!businessProfileComplete) solanaReasons.push("missing_business_profile")
  if (!solanaEnabled) solanaReasons.push("provider_disabled")
  if (solanaEnabled && !solanaConnected) solanaReasons.push("provider_not_connected")
  if (!hasProfile) solanaReasons.push("missing_wallet_profile")
  if (hasProfile && !solanaAddressPresent) solanaReasons.push("missing_solana_address")
  if (solanaPaymentReady && !dynamicSigners?.solana) solanaReasons.push("missing_dynamic_signer")

  const baseReasons: PineTreeRailReasonCode[] = []
  if (!businessProfileComplete) baseReasons.push("missing_business_profile")
  if (!baseEnabled) baseReasons.push("provider_disabled")
  if (baseEnabled && !baseConnected) baseReasons.push("provider_not_connected")
  if (!hasProfile) baseReasons.push("missing_wallet_profile")
  if (hasProfile && !baseAddressPresent) baseReasons.push("missing_base_address")
  if (basePaymentReady && !dynamicSigners?.base) baseReasons.push("missing_dynamic_signer")

  const lightningReasons: PineTreeRailReasonCode[] = []
  if (!businessProfileComplete) lightningReasons.push("missing_business_profile")
  if (!lightningEnabled) lightningReasons.push("provider_disabled")
  if (lightningEnabled && !lightningConnected) lightningReasons.push("provider_not_connected")
  if (!speedAccountReady) lightningReasons.push("missing_speed_account")
  if (!speedAccountReady && (btcAddressPresent || bitcoinOnchainAddressPresent || bitcoinLightningAddressPresent)) {
    lightningReasons.push("btc_placeholder_only")
  }

  return {
    solana: {
      rail: "solana",
      enabled: solanaEnabled,
      walletProvisioned: solanaAddressPresent,
      paymentReady: solanaPaymentReady,
      withdrawalReady: solanaWithdrawalReady,
      reasonCodes: withReadyReason(solanaWithdrawalReady, solanaReasons),
      sourceFields: {
        provider_enabled: solanaEnabled,
        business_profile_complete: businessProfileComplete,
        provider_connected: solanaConnected,
        wallet_profile_present: hasProfile,
        solana_address_present: solanaAddressPresent,
        dynamic_signer_present: Boolean(dynamicSigners?.solana),
      },
    },
    base: {
      rail: "base",
      enabled: baseEnabled,
      walletProvisioned: baseAddressPresent,
      paymentReady: basePaymentReady,
      withdrawalReady: baseWithdrawalReady,
      reasonCodes: withReadyReason(baseWithdrawalReady, baseReasons),
      sourceFields: {
        provider_enabled: baseEnabled,
        business_profile_complete: businessProfileComplete,
        provider_connected: baseConnected,
        wallet_profile_present: hasProfile,
        base_address_present: baseAddressPresent,
        dynamic_signer_present: Boolean(dynamicSigners?.base),
      },
    },
    bitcoin_lightning: {
      rail: "bitcoin_lightning",
      enabled: lightningEnabled,
      walletProvisioned: speedAccountReady,
      paymentReady: lightningPaymentReady,
      withdrawalReady: lightningWithdrawalReady,
      reasonCodes: withReadyReason(lightningWithdrawalReady, lightningReasons),
      sourceFields: {
        provider_enabled: lightningEnabled,
        business_profile_complete: businessProfileComplete,
        provider_connected: lightningConnected,
        speed_configured: Boolean(speed?.configured),
        speed_account_ready: speedAccountReady,
        speed_payout_ready: speedPayoutReady,
        speed_status: speed?.status || null,
        btc_address_present: btcAddressPresent,
        bitcoin_onchain_address_present: bitcoinOnchainAddressPresent,
        bitcoin_lightning_address_present: bitcoinLightningAddressPresent,
        btc_payout_enabled: Boolean(profile?.btc_payout_enabled),
      },
    },
  }
}

export function getPineTreeRailReadinessDiagnostics(readiness: PineTreeRailReadinessMap) {
  return Object.fromEntries(
    Object.entries(readiness).map(([rail, value]) => [
      rail,
      {
        enabled: value.enabled,
        walletProvisioned: value.walletProvisioned,
        paymentReady: value.paymentReady,
        withdrawalReady: value.withdrawalReady,
        reasonCodes: value.reasonCodes,
        sourceFields: value.sourceFields,
      },
    ])
  )
}
