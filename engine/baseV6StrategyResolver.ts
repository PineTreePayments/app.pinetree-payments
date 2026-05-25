/**
 * Base V6 Strategy Resolver
 *
 * Server-side strategy confirmation. The client sends detected wallet capabilities;
 * the server verifies relayer availability and the payer's current USDC allowance,
 * then returns the confirmed strategy the UI must execute.
 *
 * Strategies (in priority order):
 *   1. base_eth_direct          — ETH payments; no allowance check needed
 *   2. usdc_delegated_batch     — wallet_sendCalls; approve + pay in one prompt
 *   3. usdc_eip3009_relayer     — EIP-3009 typed data sign; server relays on-chain
 *   4. usdc_allowance_direct    — sufficient allowance exists; single payment tx
 *   5. usdc_allowance_two_step  — universal fallback; approve then pay
 */

import { Contract, JsonRpcProvider, Wallet, getAddress } from "ethers"
import { getPaymentById } from "@/database"
import type { StoredPaymentSplitMetadata } from "@/types/payment"
import type { BasePayWalletCapabilities } from "@/lib/basePay/strategyOrchestrator"
import {
  getBaseV6Contract,
  getBaseV6GasCap,
  getBaseV6Relayer,
  getBaseV6UsdcToken,
  getRpcUrl,
  isBaseV6DelegatedEnabled,
  isBaseV6Eip3009Enabled
} from "./config"
import { getMarketPricesUSD } from "./marketPrices"

const BASE_CHAIN_ID = 8453

const USDC_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)"
] as const

const V6_RELAYER_ABI = [
  "function relayers(address relayer) view returns (bool)"
] as const

export type BaseV6Strategy =
  | "base_eth_direct"
  | "usdc_delegated_batch"
  | "usdc_eip3009_relayer"
  | "usdc_allowance_direct"
  | "usdc_allowance_two_step"

export type BaseV6StrategyResolution = {
  ok: true
  paymentId: string
  strategy: BaseV6Strategy
  fallbackStrategy: Exclude<BaseV6Strategy, "base_eth_direct"> | null
  asset: "ETH" | "USDC"
  allowanceSufficient: boolean
  relayerAvailable: boolean
  relayerReason: string
  delegatedAvailable: boolean
  requiredUsdcAmount: string
  currentAllowance: string
  walletFamily: string
  supportsTypedData: boolean
  supportsSendCalls: boolean
  expectedWalletPrompts: number
  customerFacingNotice: string
  debugSummary: string
}

export type BaseV6StrategyError = {
  ok: false
  error: string
}

function requireEvmAddress(label: string, value: string): string {
  try {
    return getAddress(String(value || "").trim())
  } catch {
    throw new Error(`Invalid ${label}. Expected a valid 0x EVM address.`)
  }
}

async function checkRelayerAvailability(): Promise<{ available: boolean; reason: string }> {
  try {
    const { address: relayerAddress, privateKey } = getBaseV6Relayer()
    const v6Contract = getBaseV6Contract()
    const provider = new JsonRpcProvider(getRpcUrl("base"), BASE_CHAIN_ID)
    const derivedRelayerAddress = new Wallet(privateKey).address
    if (getAddress(derivedRelayerAddress) !== getAddress(relayerAddress)) {
      console.warn("[BaseV6] env_check", { reason: "relayer-private-key-address-mismatch" })
      return { available: false, reason: "relayer-private-key-address-mismatch" }
    }

    const contract = new Contract(v6Contract, V6_RELAYER_ABI, provider)
    const isAllowed = (await contract.relayers(relayerAddress)) as boolean
    if (!isAllowed) {
      console.warn("[BaseV6] env_check", { reason: "relayer-not-allowlisted" })
      return { available: false, reason: "relayer-not-allowlisted" }
    }

    const relayerBalance = await provider.getBalance(relayerAddress)
    const feeData = await provider.getFeeData()
    const gasPrice = feeData.maxFeePerGas || feeData.gasPrice
    if (!gasPrice) return { available: false, reason: "no-gas-price" }

    const estimatedGasWei = BigInt(200_000) * gasPrice
    if (relayerBalance < estimatedGasWei) return { available: false, reason: "insufficient-relayer-balance" }

    const prices = await getMarketPricesUSD()
    const { maxGasUsd } = getBaseV6GasCap()
    const estimatedGasUsd =
      Number(estimatedGasWei.toString()) * prices.ETH * 1e-18
    const available = Number.isFinite(estimatedGasUsd) && estimatedGasUsd <= maxGasUsd
    const reason = available ? "" : "gas-cap-exceeded"
    console.info("[BaseV6] env_check", { relayerAvailable: available, reason: reason || undefined })
    return { available, reason }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "relayer-check-failed"
    console.warn("[BaseV6] env_check", { relayerAvailable: false, reason })
    return { available: false, reason }
  }
}

async function checkAllowance(
  payerAddress: string,
  splitContract: string
): Promise<{ sufficient: boolean; allowance: string; required: string }> {
  try {
    const provider = new JsonRpcProvider(getRpcUrl("base"), BASE_CHAIN_ID)
    const usdcContract = new Contract(getBaseV6UsdcToken(), USDC_ABI, provider)
    const rawAllowance = (await usdcContract.allowance(payerAddress, splitContract)) as bigint

    const payment = null as unknown // resolved below via context
    void payment

    return {
      sufficient: false,
      allowance: rawAllowance.toString(),
      required: "0"
    }
  } catch {
    return { sufficient: false, allowance: "0", required: "0" }
  }
}

export async function resolveBaseV6Strategy(input: {
  paymentId: string
  payerAddress: string
  walletCapabilities: BasePayWalletCapabilities
}): Promise<BaseV6StrategyResolution | BaseV6StrategyError> {
  const paymentId = String(input.paymentId || "").trim()

  try {
    let payerAddress: string
    try {
      payerAddress = requireEvmAddress("payerAddress", input.payerAddress)
    } catch {
      return { ok: false, error: "Invalid payerAddress" }
    }

    const payment = await getPaymentById(paymentId)
    if (!payment) return { ok: false, error: "Payment not found" }

    const status = String(payment.status || "").toUpperCase()
    if (!["CREATED", "PENDING", "PROCESSING"].includes(status)) {
      return { ok: false, error: "Payment is not active" }
    }

    if (String(payment.network || "").toLowerCase().trim() !== "base") {
      return { ok: false, error: "Base V6 is only available for Base payments" }
    }

    const split = ((payment.metadata ?? null) as StoredPaymentSplitMetadata | null)?.split
    if (!split) return { ok: false, error: "Payment split metadata is missing" }

    const asset = String(split.asset || "").toUpperCase() === "USDC" ? "USDC" : "ETH"
    const v6Contract = getBaseV6Contract()
    const { walletCapabilities } = input
    const { skipDelegatedBatch, skipEip3009, walletFamily } = walletCapabilities

    // ── ETH: always direct, no allowance check ────────────────────────────────
    if (asset === "ETH") {
      return {
        ok: true,
        paymentId,
        strategy: "base_eth_direct",
        fallbackStrategy: null,
        asset: "ETH",
        allowanceSufficient: false,
        relayerAvailable: false,
        relayerReason: "not-applicable-for-eth",
        delegatedAvailable: false,
        requiredUsdcAmount: "0",
        currentAllowance: "0",
        walletFamily,
        supportsTypedData: walletCapabilities.supportsTypedData,
        supportsSendCalls: walletCapabilities.supportsSendCalls,
        expectedWalletPrompts: 1,
        customerFacingNotice: "Approve payment in your wallet.",
        debugSummary: `asset=ETH strategy=base_eth_direct walletFamily=${walletFamily}`
      }
    }

    // ── USDC: check capabilities + server-side availability ───────────────────
    const rawMerchantAmount = String(split.merchantNativeAmountAtomic ?? "0")
    const rawFeeAmount = String(split.feeNativeAmountAtomic ?? "0")
    const totalRequired =
      /^\d+$/.test(rawMerchantAmount) && /^\d+$/.test(rawFeeAmount)
        ? BigInt(rawMerchantAmount) + BigInt(rawFeeAmount)
        : BigInt(0)

    const [relayerCheck, allowanceResult] = await Promise.all([
      isBaseV6Eip3009Enabled() && !skipEip3009
        ? checkRelayerAvailability()
        : Promise.resolve({ available: false, reason: "eip3009-disabled-or-skipped" }),
      totalRequired > BigInt(0)
        ? (async () => {
            try {
              const provider = new JsonRpcProvider(getRpcUrl("base"), BASE_CHAIN_ID)
              const usdcContract = new Contract(getBaseV6UsdcToken(), USDC_ABI, provider)
              const raw = (await usdcContract.allowance(payerAddress, v6Contract)) as bigint
              return {
                sufficient: raw >= totalRequired,
                allowance: raw.toString(),
                required: totalRequired.toString()
              }
            } catch {
              return { sufficient: false, allowance: "0", required: totalRequired.toString() }
            }
          })()
        : Promise.resolve({ sufficient: false, allowance: "0", required: "0" })
    ])

    void checkAllowance // used inline above

    const relayerAvailable = relayerCheck.available
    const relayerReason = relayerCheck.reason
    const delegatedAvailable = isBaseV6DelegatedEnabled() && !skipDelegatedBatch
    const allowanceSufficient = allowanceResult.sufficient

    let strategy: BaseV6Strategy
    let fallbackStrategy: Exclude<BaseV6Strategy, "base_eth_direct"> | null
    let expectedWalletPrompts: number

    if (delegatedAvailable) {
      strategy = "usdc_delegated_batch"
      fallbackStrategy = relayerAvailable ? "usdc_eip3009_relayer" : allowanceSufficient ? "usdc_allowance_direct" : "usdc_allowance_two_step"
      expectedWalletPrompts = 1
    } else if (relayerAvailable) {
      strategy = "usdc_eip3009_relayer"
      fallbackStrategy = allowanceSufficient ? "usdc_allowance_direct" : "usdc_allowance_two_step"
      expectedWalletPrompts = 1
    } else if (allowanceSufficient) {
      strategy = "usdc_allowance_direct"
      fallbackStrategy = "usdc_allowance_two_step"
      expectedWalletPrompts = 1
    } else {
      strategy = "usdc_allowance_two_step"
      fallbackStrategy = null
      expectedWalletPrompts = 2
    }

    const debugSummary = [
      `asset=USDC`,
      `strategy=${strategy}`,
      `walletFamily=${walletFamily}`,
      `skipDelegatedBatch=${skipDelegatedBatch}`,
      `skipEip3009=${skipEip3009}`,
      `delegatedAvailable=${delegatedAvailable}`,
      `relayerAvailable=${relayerAvailable}`,
      `allowanceSufficient=${allowanceSufficient}`
    ].join(" | ")

    console.info("[BaseV6] usdc_strategy_response", {
      paymentId,
      strategy,
      relayerAvailable,
      relayerReason: relayerReason || undefined,
      allowanceSufficient,
      requiredUsdcAmount: allowanceResult.required,
      currentAllowance: allowanceResult.allowance,
      walletFamily,
      supportsTypedData: walletCapabilities.supportsTypedData,
      supportsSendCalls: walletCapabilities.supportsSendCalls
    })

    return {
      ok: true,
      paymentId,
      strategy,
      fallbackStrategy,
      asset: "USDC",
      allowanceSufficient,
      relayerAvailable,
      relayerReason,
      delegatedAvailable,
      requiredUsdcAmount: allowanceResult.required,
      currentAllowance: allowanceResult.allowance,
      walletFamily,
      supportsTypedData: walletCapabilities.supportsTypedData,
      supportsSendCalls: walletCapabilities.supportsSendCalls,
      expectedWalletPrompts,
      customerFacingNotice:
        strategy === "usdc_allowance_two_step"
          ? "Approve USDC authorization, then approve final payment."
          : strategy === "usdc_eip3009_relayer"
            ? "Authorize USDC payment in your wallet."
            : "Approve payment in your wallet.",
      debugSummary
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[BASE V6] strategy resolution error", { paymentId, error: message })
    return { ok: false, error: message }
  }
}
