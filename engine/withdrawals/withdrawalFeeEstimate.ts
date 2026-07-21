/**
 * Real, gas/fee-aware Max-withdrawal calculation for PineTree Wallet.
 *
 * For native assets (Base ETH, Solana SOL):
 *   max = confirmed balance - pending outgoing - estimated network fee - configured reserve
 *
 * For token assets (Base USDC, Solana USDC):
 *   max = confirmed token balance - pending outgoing token withdrawals
 *   (gas is paid in the NATIVE asset, never subtracted from the token
 *   balance itself) - but the native balance must separately cover the
 *   estimated fee, or the withdrawal is blocked with a clear message
 *   rather than silently allowed to fail on submission.
 *
 * For Bitcoin: Speed has no pre-flight fee-quote endpoint (fees are only
 * returned after execution - confirmed by reading
 * providers/lightning/speedWalletManagement.ts), so Max uses a conservative
 * configured buffer instead of an RPC-derived estimate, clearly labeled as
 * an estimate by the caller.
 *
 * Fee estimates for Base/Solana use real RPC calls (eth_gasPrice/
 * eth_estimateGas, Solana getFeeForMessage) against a self-transfer (source
 * -> source), since this endpoint is called before a destination is chosen
 * (from the Max button, not from full withdrawal review) - a reasonable
 * upper-bound approximation, not a submission-time-exact quote. The
 * configured safety multiplier absorbs the small variance between a
 * self-transfer estimate and the real destination's actual gas cost (e.g.
 * cold vs. warm ERC-20 storage slot).
 */

import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js"
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createTransferCheckedInstruction } from "@solana/spl-token"
import { encodeFunctionData } from "viem"
import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import { getWalletBalance } from "@/database/walletBalances"
import { sumPendingWalletWithdrawalAmount, type WalletWithdrawalRail, type WalletWithdrawalAsset } from "@/database/walletWithdrawalRequests"
import { sumPendingWithdrawalOperationBaseUnits } from "@/database/merchantWalletOperations"
import { toBaseUnits, fromBaseUnits, clampNonNegative } from "@/engine/withdrawals/decimalUnits"

// ── Feature-local configuration (mirrors engine/lightningSweep.ts's pattern
// for narrow, feature-specific tunables rather than the cross-cutting
// engine/config.ts) ─────────────────────────────────────────────────────────

function getBaseEthMinReserve(): number {
  const configured = Number(process.env.BASE_ETH_MIN_RESERVE || "")
  return Number.isFinite(configured) && configured >= 0 ? configured : 0.0003
}

function getSolanaSolMinReserve(): number {
  const configured = Number(process.env.SOLANA_SOL_MIN_RESERVE || "")
  return Number.isFinite(configured) && configured >= 0 ? configured : 0.002
}

function getWithdrawalFeeSafetyMultiplier(): number {
  const configured = Number(process.env.WITHDRAWAL_FEE_SAFETY_MULTIPLIER || "")
  return Number.isFinite(configured) && configured >= 1 ? configured : 1.3
}

function getBtcMaxWithdrawalFeeBufferSats(): number {
  const configured = Number(process.env.BTC_MAX_WITHDRAWAL_FEE_BUFFER_SATS || "")
  return Number.isFinite(configured) && configured >= 0 ? Math.round(configured) : 500
}

export type MaxWithdrawalEstimate = {
  maxDecimal: string
  feeEstimateDecimal: string
  feeAsset: string
  /** Set (and maxDecimal forced to "0") when the withdrawal is blocked entirely, e.g. insufficient native gas. */
  blocked?: boolean
  warning?: string
}

function walletBalanceKey(rail: WalletWithdrawalRail, asset: WalletWithdrawalAsset): string {
  if (rail === "base") return asset === "ETH" ? "BASE_ETH" : "BASE_USDC"
  if (rail === "solana") return asset === "SOL" ? "SOLANA_SOL" : "SOLANA_USDC"
  return "BTC"
}

function getBaseRpcUrl(): string {
  return String(process.env.BASE_RPC_URL || "").trim() || "https://mainnet.base.org"
}

function getSolanaRpcUrl(): string {
  return (
    process.env.RPC_URL_SOLANA ||
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com"
  )
}

async function ethRpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(getBaseRpcUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  })
  const payload = await res.json()
  if (payload.error) throw new Error(`Base RPC error: ${payload.error.message || method}`)
  return payload.result as T
}

const BASE_USDC_TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const ERC20_TRANSFER_ABI = [{
  type: "function",
  name: "transfer",
  stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }],
}] as const

/**
 * Estimates the Base network fee (in ETH) for a native ETH or USDC transfer,
 * as a self-transfer (source -> source) since the real destination isn't
 * known yet at Max-button time. Returns null (never throws) on any RPC
 * failure so callers fall back to a configured default rather than blocking
 * the whole Max calculation on a transient RPC hiccup.
 */
async function estimateBaseFeeWei(asset: "ETH" | "USDC", sourceAddress: string): Promise<bigint | null> {
  try {
    const [gasPriceHex, gasEstimateHex] = await Promise.all([
      ethRpcCall<string>("eth_gasPrice", []),
      asset === "ETH"
        ? ethRpcCall<string>("eth_estimateGas", [{ from: sourceAddress, to: sourceAddress, value: "0x1" }])
        : ethRpcCall<string>("eth_estimateGas", [{
            from: sourceAddress,
            to: BASE_USDC_TOKEN_ADDRESS,
            data: encodeFunctionData({ abi: ERC20_TRANSFER_ABI, functionName: "transfer", args: [sourceAddress as `0x${string}`, BigInt(1)] }),
          }]),
    ])
    const gasPrice = BigInt(gasPriceHex)
    const gasEstimate = BigInt(gasEstimateHex)
    return gasPrice * gasEstimate
  } catch (error) {
    console.warn("[withdrawalFeeEstimate] Base fee estimate failed, falling back to configured reserve", error)
    return null
  }
}

const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

/**
 * Estimates the Solana network fee (in lamports) for a SOL or USDC transfer,
 * as a self-transfer. Includes the associated-token-account rent-exempt
 * minimum for USDC only when the source's own ATA doesn't already exist
 * (a reasonable proxy for "may need to create one" - the real destination's
 * ATA existence is checked again, precisely, during actual review/submit).
 * Returns null (never throws) on any RPC failure.
 */
async function estimateSolanaFeeLamports(asset: "SOL" | "USDC", sourceAddress: string): Promise<bigint | null> {
  try {
    const connection = new Connection(getSolanaRpcUrl(), "confirmed")
    const source = new PublicKey(sourceAddress)
    const transaction = new Transaction()
    transaction.feePayer = source
    transaction.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash

    let extraRentLamports = BigInt(0)
    if (asset === "SOL") {
      transaction.add(SystemProgram.transfer({ fromPubkey: source, toPubkey: source, lamports: 1 }))
    } else {
      const mint = new PublicKey(SOLANA_USDC_MINT)
      const sourceAta = await getAssociatedTokenAddress(mint, source)
      const info = await connection.getAccountInfo(sourceAta)
      if (!info) {
        transaction.add(createAssociatedTokenAccountInstruction(source, sourceAta, source, mint))
        extraRentLamports = BigInt(await connection.getMinimumBalanceForRentExemption(165))
      }
      transaction.add(createTransferCheckedInstruction(sourceAta, mint, sourceAta, source, BigInt(1), 6))
    }

    const message = transaction.compileMessage()
    const feeResult = await connection.getFeeForMessage(message, "confirmed")
    const signatureFee = BigInt(feeResult.value ?? 5000)
    return signatureFee + extraRentLamports
  } catch (error) {
    console.warn("[withdrawalFeeEstimate] Solana fee estimate failed, falling back to configured reserve", error)
    return null
  }
}

export async function estimateMaxWithdrawalAmount(
  merchantId: string,
  rail: WalletWithdrawalRail,
  asset: WalletWithdrawalAsset
): Promise<MaxWithdrawalEstimate> {
  if (rail === "bitcoin") {
    const btc = await getWalletBalance(merchantId, "BTC")
    const confirmedSats = toBaseUnits(btc?.balance ?? "0", "BTC")
    const pendingBaseUnits = await sumPendingWithdrawalOperationBaseUnits(merchantId, "SATS")
    const bufferSats = BigInt(getBtcMaxWithdrawalFeeBufferSats())
    const maxSats = clampNonNegative(confirmedSats - pendingBaseUnits - bufferSats)
    return {
      maxDecimal: fromBaseUnits(maxSats, "BTC"),
      feeEstimateDecimal: fromBaseUnits(bufferSats, "BTC"),
      feeAsset: "BTC",
      warning: "Bitcoin's exact network fee is set at send time - this Max leaves a small buffer as an estimate.",
    }
  }

  const profile = await getPineTreeWalletProfile(merchantId)
  const sourceAddress = rail === "base" ? profile?.base_address : profile?.solana_address
  const balanceRow = await getWalletBalance(merchantId, walletBalanceKey(rail, asset))
  const confirmedBaseUnits = toBaseUnits(balanceRow?.balance ?? "0", asset)
  const pendingDecimal = await sumPendingWalletWithdrawalAmount(merchantId, rail, asset)
  const pendingBaseUnits = toBaseUnits(pendingDecimal, asset)

  const isNative = asset === "ETH" || asset === "SOL"
  const nativeAsset = rail === "base" ? "ETH" : "SOL"
  const nativeAssetLabel = rail === "base" ? "ETH on Base" : "SOL on Solana"

  if (!sourceAddress) {
    return { maxDecimal: "0", feeEstimateDecimal: "0", feeAsset: nativeAsset, blocked: true, warning: "PineTree Wallet source address is not available yet." }
  }

  const feeBaseUnitsRaw = rail === "base"
    ? await estimateBaseFeeWei(asset as "ETH" | "USDC", sourceAddress)
    : await estimateSolanaFeeLamports(asset as "SOL" | "USDC", sourceAddress)

  const multiplier = getWithdrawalFeeSafetyMultiplier()
  const configuredReserve = rail === "base" ? getBaseEthMinReserve() : getSolanaSolMinReserve()
  const reserveBaseUnits = toBaseUnits(configuredReserve, nativeAsset)

  // A real RPC estimate, safety-padded; falls back to the configured reserve
  // alone (as the fee estimate) if the RPC call failed, so the Max
  // calculation degrades gracefully rather than throwing.
  const feeBaseUnits = feeBaseUnitsRaw !== null
    ? BigInt(Math.ceil(Number(feeBaseUnitsRaw) * multiplier))
    : reserveBaseUnits

  if (isNative) {
    const maxBaseUnits = clampNonNegative(confirmedBaseUnits - pendingBaseUnits - feeBaseUnits - reserveBaseUnits)
    return {
      maxDecimal: fromBaseUnits(maxBaseUnits, asset),
      feeEstimateDecimal: fromBaseUnits(feeBaseUnits, asset),
      feeAsset: nativeAsset,
    }
  }

  // Token withdrawal (USDC): never subtract gas from the token balance -
  // check the native balance separately and block with a clear message if
  // it can't cover the estimated fee.
  const nativeBalanceRow = await getWalletBalance(merchantId, walletBalanceKey(rail, nativeAsset as WalletWithdrawalAsset))
  const nativeBalanceBaseUnits = toBaseUnits(nativeBalanceRow?.balance ?? "0", nativeAsset)
  const nativePendingDecimal = await sumPendingWalletWithdrawalAmount(merchantId, rail, nativeAsset as WalletWithdrawalAsset)
  const nativeAvailableBaseUnits = clampNonNegative(nativeBalanceBaseUnits - toBaseUnits(nativePendingDecimal, nativeAsset))

  if (nativeAvailableBaseUnits < feeBaseUnits + reserveBaseUnits) {
    return {
      maxDecimal: "0",
      feeEstimateDecimal: fromBaseUnits(feeBaseUnits, nativeAsset),
      feeAsset: nativeAsset,
      blocked: true,
      warning: `This wallet does not currently have enough ${nativeAssetLabel} to cover the network fee for this ${asset} withdrawal.`,
    }
  }

  const maxTokenBaseUnits = clampNonNegative(confirmedBaseUnits - pendingBaseUnits)
  return {
    maxDecimal: fromBaseUnits(maxTokenBaseUnits, asset),
    feeEstimateDecimal: fromBaseUnits(feeBaseUnits, nativeAsset),
    feeAsset: nativeAsset,
  }
}
