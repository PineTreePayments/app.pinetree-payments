import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token"
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js"
import { encodeFunctionData } from "viem"
import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import {
  sumPendingWalletWithdrawalAmount,
} from "@/database/walletWithdrawalRequests"
import { toBaseUnits, clampNonNegative } from "@/engine/withdrawals/decimalUnits"
import {
  evaluateWithdrawalPreflight,
  unavailableWithdrawalPreflight,
  type WithdrawalCapacity,
  type WithdrawalPreflightResult,
} from "@/engine/withdrawals/withdrawalPreflightResult"

export {
  evaluateWithdrawalPreflight,
  unavailableWithdrawalPreflight,
  WithdrawalPreflightError,
  type WithdrawalCapacity,
  type WithdrawalPreflightFailureReason,
  type WithdrawalPreflightResult,
} from "@/engine/withdrawals/withdrawalPreflightResult"

const BASE_USDC_TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const

function readReserveBaseUnits(name: string, fallback: string, asset: "ETH" | "SOL") {
  const configured = String(process.env[name] || "").trim()
  return toBaseUnits(/^\d+(\.\d+)?$/.test(configured) ? configured : fallback, asset)
}

function feeSafetyRatio(): { numerator: bigint; denominator: bigint } {
  const raw = String(process.env.WITHDRAWAL_FEE_SAFETY_MULTIPLIER || "1.3").trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) return { numerator: BigInt(13), denominator: BigInt(10) }
  const [whole, fraction = ""] = raw.split(".")
  const denominator = BigInt(10) ** BigInt(fraction.length)
  const numerator = BigInt(whole) * denominator + BigInt(fraction || "0")
  return numerator >= denominator ? { numerator, denominator } : { numerator: denominator, denominator }
}

function applyFeeSafety(value: bigint): bigint {
  const { numerator, denominator } = feeSafetyRatio()
  return (value * numerator + denominator - BigInt(1)) / denominator
}

function baseRpcUrl() {
  return String(process.env.BASE_RPC_URL || "").trim() || "https://mainnet.base.org"
}

function solanaRpcUrl() {
  return String(
    process.env.RPC_URL_SOLANA ||
      process.env.SOLANA_RPC_URL ||
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
      "https://api.mainnet-beta.solana.com"
  )
}

async function getSolanaBalanceLamports(address: string): Promise<bigint> {
  const response = await fetch(solanaRpcUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address, { commitment: "confirmed" }] }),
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`Solana balance RPC returned HTTP ${response.status}`)
  // Read the integer token directly from the wire so a large lamport balance
  // never passes through JavaScript Number before becoming bigint.
  const raw = await response.text()
  const match = raw.match(/"value"\s*:\s*(\d+)/)
  if (!match) throw new Error("Solana balance RPC did not return a base-unit balance")
  return BigInt(match[1])
}

async function baseRpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(baseRpcUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`Base balance RPC returned HTTP ${response.status}`)
  const payload = (await response.json()) as { result?: T; error?: { code?: number } }
  if (payload.error || payload.result === undefined) throw new Error(`Base balance RPC failed (${payload.error?.code ?? "unknown"})`)
  return payload.result
}

async function resolveBaseCapacity(input: {
  merchantId: string
  asset: "ETH" | "USDC"
  sourceAddress: string
  destinationAddress?: string
  requestedBaseUnits?: bigint
}): Promise<WithdrawalCapacity> {
  const destination = input.destinationAddress || input.sourceAddress
  const amount = input.requestedBaseUnits && input.requestedBaseUnits > BigInt(0) ? input.requestedBaseUnits : BigInt(1)
  const [ethHex, assetHex, pendingDecimal, nativePendingDecimal] = await Promise.all([
    baseRpc<string>("eth_getBalance", [input.sourceAddress, "latest"]),
    input.asset === "ETH"
      ? Promise.resolve<string>("0x0")
      : baseRpc<string>("eth_call", [
          {
            to: BASE_USDC_TOKEN_ADDRESS,
            data: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [input.sourceAddress as `0x${string}`],
            }),
          },
          "latest",
        ]),
    sumPendingWalletWithdrawalAmount(input.merchantId, "base", input.asset),
    input.asset === "ETH"
      ? Promise.resolve("0")
      : sumPendingWalletWithdrawalAmount(input.merchantId, "base", "ETH"),
  ])
  const ethBalance = BigInt(ethHex)
  const available = input.asset === "ETH" ? ethBalance : BigInt(assetHex)
  const pending = toBaseUnits(pendingDecimal, input.asset)
  const nativePending = toBaseUnits(nativePendingDecimal, "ETH")
  const reserve = readReserveBaseUnits("BASE_ETH_MIN_RESERVE", "0.0003", "ETH")
  const assetAvailableAfterPending = clampNonNegative(available - pending)
  const nativeAvailableAfterPending = clampNonNegative(ethBalance - nativePending)
  // Prove obvious underfunding from authoritative balances before asking the
  // RPC to estimate a transaction it already cannot afford.
  const obviouslyUnderfunded = amount > assetAvailableAfterPending || (
    input.asset === "ETH"
      ? amount > clampNonNegative(assetAvailableAfterPending - reserve)
      : nativeAvailableAfterPending < reserve
  )
  let fee = BigInt(0)
  if (!obviouslyUnderfunded) {
    const transferData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [destination as `0x${string}`, amount],
    })
    const [gasPriceHex, gasEstimateHex] = await Promise.all([
      baseRpc<string>("eth_gasPrice", []),
      input.asset === "ETH"
        ? baseRpc<string>("eth_estimateGas", [{ from: input.sourceAddress, to: destination, value: `0x${amount.toString(16)}` }])
        : baseRpc<string>("eth_estimateGas", [{ from: input.sourceAddress, to: BASE_USDC_TOKEN_ADDRESS, data: transferData }]),
    ])
    fee = applyFeeSafety(BigInt(gasPriceHex) * BigInt(gasEstimateHex))
  }
  return {
    rail: "base",
    asset: input.asset,
    network: "Base",
    availableBaseUnits: available,
    pendingBaseUnits: pending,
    spendableBaseUnits:
      input.asset === "ETH"
        ? clampNonNegative(available - pending - fee - reserve)
        : clampNonNegative(available - pending),
    feeBaseUnits: fee,
    reserveBaseUnits: reserve,
    feeAsset: "ETH",
    nativeAvailableBaseUnits: ethBalance,
    nativePendingBaseUnits: nativePending,
    verifiedAt: new Date().toISOString(),
  }
}

async function resolveSolanaCapacity(input: {
  merchantId: string
  asset: "SOL" | "USDC"
  sourceAddress: string
  destinationAddress?: string
  requestedBaseUnits?: bigint
}): Promise<WithdrawalCapacity> {
  const connection = new Connection(solanaRpcUrl(), "confirmed")
  const source = new PublicKey(input.sourceAddress)
  const destination = new PublicKey(input.destinationAddress || input.sourceAddress)
  const amount = input.requestedBaseUnits && input.requestedBaseUnits > BigInt(0) ? input.requestedBaseUnits : BigInt(1)
  const transaction = new Transaction()
  transaction.feePayer = source
  transaction.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash
  let tokenBalance = BigInt(0)
  let destinationRent = BigInt(0)

  if (input.asset === "SOL") {
    transaction.add(SystemProgram.transfer({ fromPubkey: source, toPubkey: destination, lamports: amount }))
  } else {
    const mint = new PublicKey(SOLANA_USDC_MINT)
    const sourceAta = await getAssociatedTokenAddress(mint, source)
    const destinationAta = await getAssociatedTokenAddress(mint, destination)
    const [sourceInfo, destinationInfo] = await Promise.all([
      connection.getAccountInfo(sourceAta, "confirmed"),
      input.destinationAddress ? connection.getAccountInfo(destinationAta, "confirmed") : Promise.resolve(null),
    ])
    if (sourceInfo) {
      tokenBalance = BigInt((await connection.getTokenAccountBalance(sourceAta, "confirmed")).value.amount)
    }
    if (!destinationInfo) {
      transaction.add(createAssociatedTokenAccountInstruction(source, destinationAta, destination, mint))
      destinationRent = BigInt(await connection.getMinimumBalanceForRentExemption(165, "confirmed"))
    }
    transaction.add(createTransferCheckedInstruction(sourceAta, mint, destinationAta, source, amount, 6))
  }

  const [solBalance, feeResult, pendingDecimal, nativePendingDecimal] = await Promise.all([
    getSolanaBalanceLamports(input.sourceAddress),
    connection.getFeeForMessage(transaction.compileMessage(), "confirmed"),
    sumPendingWalletWithdrawalAmount(input.merchantId, "solana", input.asset),
    input.asset === "SOL"
      ? Promise.resolve("0")
      : sumPendingWalletWithdrawalAmount(input.merchantId, "solana", "SOL"),
  ])
  if (feeResult.value == null) throw new Error("Solana fee could not be verified")
  const available = input.asset === "SOL" ? solBalance : tokenBalance
  const pending = toBaseUnits(pendingDecimal, input.asset)
  const nativePending = toBaseUnits(nativePendingDecimal, "SOL")
  const fee = applyFeeSafety(BigInt(feeResult.value)) + destinationRent
  const reserve = readReserveBaseUnits("SOLANA_SOL_MIN_RESERVE", "0.002", "SOL")
  return {
    rail: "solana",
    asset: input.asset,
    network: "Solana",
    availableBaseUnits: available,
    pendingBaseUnits: pending,
    spendableBaseUnits:
      input.asset === "SOL"
        ? clampNonNegative(available - pending - fee - reserve)
        : clampNonNegative(available - pending),
    feeBaseUnits: fee,
    reserveBaseUnits: reserve,
    feeAsset: "SOL",
    nativeAvailableBaseUnits: solBalance,
    nativePendingBaseUnits: nativePending,
    verifiedAt: new Date().toISOString(),
  }
}

export async function resolveAuthoritativeWithdrawalCapacity(input: {
  merchantId: string
  rail: "base" | "solana"
  asset: "ETH" | "USDC" | "SOL"
  destinationAddress?: string
  requestedAmount?: string
}): Promise<WithdrawalCapacity> {
  const profile = await getPineTreeWalletProfile(input.merchantId)
  const sourceAddress = input.rail === "base" ? profile?.base_address : profile?.solana_address
  if (!sourceAddress) throw new Error("PineTree Wallet source address is unavailable")
  const requestedBaseUnits = input.requestedAmount ? toBaseUnits(input.requestedAmount, input.asset) : undefined
  if (input.rail === "base") {
    return resolveBaseCapacity({
      merchantId: input.merchantId,
      asset: input.asset as "ETH" | "USDC",
      sourceAddress,
      destinationAddress: input.destinationAddress,
      requestedBaseUnits,
    })
  }
  return resolveSolanaCapacity({
    merchantId: input.merchantId,
    asset: input.asset as "SOL" | "USDC",
    sourceAddress,
    destinationAddress: input.destinationAddress,
    requestedBaseUnits,
  })
}

export async function preflightDynamicWithdrawal(input: {
  merchantId: string
  rail: "base" | "solana"
  asset: "ETH" | "USDC" | "SOL"
  destinationAddress: string
  amountDecimal: string
  correlationId?: string | null
  withdrawalId?: string | null
}): Promise<WithdrawalPreflightResult> {
  try {
    const capacity = await resolveAuthoritativeWithdrawalCapacity({
      merchantId: input.merchantId,
      rail: input.rail,
      asset: input.asset,
      destinationAddress: input.destinationAddress,
      requestedAmount: input.amountDecimal,
    })
    return evaluateWithdrawalPreflight({
      capacity,
      requestedBaseUnits: toBaseUnits(input.amountDecimal, input.asset),
    })
  } catch (error) {
    console.warn("[pinetree-withdrawals] authoritative_balance_verification_failed", {
      correlationId: input.correlationId || null,
      withdrawalId: input.withdrawalId || null,
      merchantId: input.merchantId,
      rail: input.rail,
      asset: input.asset,
      providerErrorClass: error instanceof Error ? error.name : "Error",
      technicalError: error instanceof Error ? error.message : String(error || "unknown_error"),
    })
    return unavailableWithdrawalPreflight({ rail: input.rail, asset: input.asset, requestedAmount: input.amountDecimal })
  }
}
