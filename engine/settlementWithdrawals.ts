// Settlement Withdrawal engine.
// Handles prepare (unsigned tx / tx params), submit (tx hash recording), and history.
// PineTree NEVER moves funds — the merchant's connected wallet signs and broadcasts.
// No private keys or signing material are stored or transmitted.

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction
} from "@solana/web3.js"
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction
} from "@solana/spl-token"
import { getRpcUrl } from "@/engine/config"
import { getSettlementDestination } from "@/database/settlementDestinations"
import { getMerchantWallets } from "@/database/merchantWallets"
import {
  createSettlementWithdrawal,
  updateSettlementWithdrawalStatus,
  listSettlementWithdrawalsForMerchant,
  type SettlementWithdrawalRecord
} from "@/database/settlementWithdrawals"

// ─── Network constants ────────────────────────────────────────────────────────

const SOLANA_USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
const SOLANA_USDC_DECIMALS = 6
const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

// ERC-20 transfer(address,uint256) selector
const ERC20_TRANSFER_SELECTOR = "0xa9059cbb"

// ─── Amount utilities ─────────────────────────────────────────────────────────

// Parse a decimal string to SOL lamports (9 decimals). Rejects negative / non-finite.
function solToLamports(amountStr: string): number {
  const n = Number(amountStr)
  if (!Number.isFinite(n) || n <= 0) throw new Error("Amount must be a positive number.")
  return Math.round(n * 1_000_000_000)
}

// Parse a decimal string to atomic units using the given decimal places.
// Avoids floating-point drift for USDC (6 dec) and ETH (18 dec).
function decimalToAtomicBigInt(amountStr: string, decimals: number): bigint {
  const trimmed = amountStr.trim()
  if (!trimmed || trimmed === "0") throw new Error("Amount must be greater than zero.")

  const [whole = "0", frac = ""] = trimmed.split(".")
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, "0")

  const wholePart = BigInt(whole) * BigInt(10 ** decimals)
  const fracPart  = BigInt(fracPadded)
  const total     = wholePart + fracPart

  if (total <= BigInt(0)) throw new Error("Amount must be greater than zero.")
  return total
}

// ─── Base tx-param builder ────────────────────────────────────────────────────

export type BaseTxParams = {
  from: string
  to: string
  value: string   // hex wei string "0x..."
  data: string    // "0x" for ETH, ABI-encoded ERC20 transfer for USDC
  gas: string     // hex gas limit
}

function buildBaseEthTxParams(
  fromAddress: string,
  toAddress: string,
  amountStr: string
): BaseTxParams {
  const weiAmount = decimalToAtomicBigInt(amountStr, 18)
  return {
    from: fromAddress,
    to: toAddress,
    value: "0x" + weiAmount.toString(16),
    data: "0x",
    gas: "0x5208"   // 21000 — standard native ETH transfer
  }
}

function buildBaseUsdcTxParams(
  fromAddress: string,
  toAddress: string,
  amountStr: string
): BaseTxParams {
  const units = decimalToAtomicBigInt(amountStr, 6)
  // ABI encode: transfer(address to, uint256 amount)
  const toEncoded     = toAddress.slice(2).toLowerCase().padStart(64, "0")
  const amountEncoded = units.toString(16).padStart(64, "0")
  const data = ERC20_TRANSFER_SELECTOR + toEncoded + amountEncoded

  return {
    from: fromAddress,
    to: BASE_USDC_ADDRESS,
    value: "0x0",
    data,
    gas: "0x186A0"   // 100000 — generous for ERC20 transfer
  }
}

// ─── Solana tx builder ────────────────────────────────────────────────────────

async function buildSolanaWithdrawalUnsignedTx(
  senderAddress: string,
  recipientAddress: string,
  asset: string,
  amountStr: string
): Promise<string> {
  const senderPubkey    = new PublicKey(senderAddress)
  const recipientPubkey = new PublicKey(recipientAddress)

  const rpcUrl    = getRpcUrl("solana")
  const conn      = new Connection(rpcUrl, "confirmed")
  const { blockhash } = await conn.getLatestBlockhash("confirmed")

  const tx = new Transaction({ feePayer: senderPubkey, recentBlockhash: blockhash })

  if (asset === "SOL") {
    const lamports = solToLamports(amountStr)
    tx.add(
      SystemProgram.transfer({
        fromPubkey: senderPubkey,
        toPubkey:   recipientPubkey,
        lamports
      })
    )
  } else if (asset === "USDC") {
    const units = decimalToAtomicBigInt(amountStr, SOLANA_USDC_DECIMALS)

    const [senderAta, recipientAta] = await Promise.all([
      getAssociatedTokenAddress(SOLANA_USDC_MINT, senderPubkey),
      getAssociatedTokenAddress(SOLANA_USDC_MINT, recipientPubkey)
    ])

    tx.add(
      // Idempotent ATA creation for recipient — no-op if already exists.
      // Merchant's wallet funds rent if a new ATA must be created.
      createAssociatedTokenAccountIdempotentInstruction(
        senderPubkey, recipientAta, recipientPubkey, SOLANA_USDC_MINT
      ),
      createTransferInstruction(
        senderAta, recipientAta, senderPubkey, units
      )
    )
  } else {
    throw new Error(`Unsupported Solana asset: ${asset}`)
  }

  return tx.serialize({ requireAllSignatures: false }).toString("base64")
}

// ─── Prepare withdrawal ───────────────────────────────────────────────────────

export type PrepareWithdrawalResult = {
  withdrawal: SettlementWithdrawalRecord
  // Solana-specific
  unsignedTxBase64?: string
  // Base-specific
  txParams?: BaseTxParams
}

export type PrepareDirectWalletTransferResult = {
  transfer: {
    id: null
    wallet_id: string | null
    asset: string
    network: string
    amount: number
    destination_address: string
    destination_label: string
    status: "PREPARED"
    estimated_fee_label: string
  }
  // Solana-specific
  unsignedTxBase64?: string
  // Base-specific
  txParams?: BaseTxParams
}

function validateTransferDestinationAddress(network: string, address: string): void {
  const n = network.toLowerCase()
  const a = address.trim()

  if (n === "base" || n === "ethereum") {
    if (!/^0x[a-fA-F0-9]{40}$/.test(a)) {
      throw Object.assign(new Error("Invalid destination address format for Base."), { status: 422 })
    }
    return
  }

  if (n === "solana") {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) {
      throw Object.assign(new Error("Invalid destination address format for Solana."), { status: 422 })
    }
    return
  }

  throw Object.assign(new Error(`Unsupported network: ${network}.`), { status: 422 })
}

function validateTransferAmount(amount: string): number {
  const amountNum = Number(amount)
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw Object.assign(new Error("Amount must be a positive number."), { status: 422 })
  }
  return amountNum
}

function validateSupportedTransferCombo(asset: string, network: string, label: string): void {
  const supportedCombos = [
    ["SOL", "solana"],
    ["USDC", "solana"],
    ["USDC", "base"],
    ["ETH", "base"]
  ]
  if (!supportedCombos.some(([a, n]) => a === asset && n === network)) {
    throw Object.assign(
      new Error(`${label} not supported for ${asset} on ${network}.`),
      { status: 422 }
    )
  }
}

export async function prepareSettlementWithdrawal(
  merchantId: string,
  input: {
    settlementDestinationId: string
    walletId: string | null
    walletAddress: string
    walletNetwork: string
    amount: string
  }
): Promise<PrepareWithdrawalResult> {
  // ── Validate destination belongs to this merchant ─────────────────────────
  const dest = await getSettlementDestination(merchantId, input.settlementDestinationId)
  if (!dest) {
    throw Object.assign(new Error("Settlement destination not found."), { status: 404 })
  }

  // ── Validate wallet network matches destination network ───────────────────
  const destNetwork = dest.network.toLowerCase()
  const walletNetwork = input.walletNetwork.toLowerCase()

  if (destNetwork !== walletNetwork) {
    throw Object.assign(
      new Error(
        `Network mismatch: destination is on ${dest.network} but your connected wallet is on ${input.walletNetwork}.`
      ),
      { status: 422 }
    )
  }

  // ── Validate merchant has a connected wallet for this network ─────────────
  const merchantWallets = await getMerchantWallets(merchantId)
  const walletForNetwork = merchantWallets.find(
    (w) => w.network.toLowerCase() === destNetwork && w.wallet_address
  )
  if (!walletForNetwork && !input.walletAddress) {
    throw Object.assign(
      new Error(`No connected wallet found for ${dest.network}. Connect a wallet on the Providers page first.`),
      { status: 422 }
    )
  }

  // ── Validate address format ───────────────────────────────────────────────
  const address = dest.address.trim()
  validateTransferDestinationAddress(destNetwork, address)

  // ── Validate amount ───────────────────────────────────────────────────────
  const amountNum = validateTransferAmount(input.amount)

  // ── Validate asset/network combination ───────────────────────────────────
  const asset = dest.asset.toUpperCase()
  validateSupportedTransferCombo(asset, destNetwork, "Withdrawal")

  // ── Build network-specific tx data ────────────────────────────────────────
  const senderAddress = input.walletAddress || walletForNetwork!.wallet_address
  let unsignedTxBase64: string | undefined
  let txParams: BaseTxParams | undefined

  if (destNetwork === "solana") {
    unsignedTxBase64 = await buildSolanaWithdrawalUnsignedTx(
      senderAddress, address, asset, input.amount
    )
  } else if (destNetwork === "base") {
    if (asset === "ETH") {
      txParams = buildBaseEthTxParams(senderAddress, address, input.amount)
    } else if (asset === "USDC") {
      txParams = buildBaseUsdcTxParams(senderAddress, address, input.amount)
    }
  }

  // ── Create withdrawal record ──────────────────────────────────────────────
  const withdrawal = await createSettlementWithdrawal({
    merchantId,
    walletId: input.walletId,
    settlementDestinationId: dest.id,
    destinationLabel: dest.label,
    exchangeName: dest.exchange_name,
    asset,
    network: destNetwork,
    amount: amountNum,
    destinationAddress: address,
    memoOrTag: dest.memo_or_tag,
    status: "PREPARED"
  })

  return { withdrawal, unsignedTxBase64, txParams }
}

// ─── Submit tx hash / signature ───────────────────────────────────────────────

export async function prepareDirectWalletTransfer(
  merchantId: string,
  input: {
    walletId: string | null
    walletAddress: string
    walletNetwork: string
    asset: string
    destinationAddress: string
    amount: string
  }
): Promise<PrepareDirectWalletTransferResult> {
  const walletNetwork = input.walletNetwork.toLowerCase()
  const asset = input.asset.trim().toUpperCase()
  const amountNum = validateTransferAmount(input.amount)
  const destinationAddress = input.destinationAddress.trim()
  const senderAddress = input.walletAddress.trim()

  if (!senderAddress) {
    throw Object.assign(new Error("wallet_address is required."), { status: 400 })
  }

  validateSupportedTransferCombo(asset, walletNetwork, "Send")
  validateTransferDestinationAddress(walletNetwork, destinationAddress)

  const merchantWallets = await getMerchantWallets(merchantId)
  const walletForNetwork = merchantWallets.find(
    (w) => w.network.toLowerCase() === walletNetwork && w.wallet_address
  )
  if (!walletForNetwork) {
    throw Object.assign(
      new Error(`No connected wallet found for ${walletNetwork}. Connect a wallet on the Providers page first.`),
      { status: 422 }
    )
  }

  let unsignedTxBase64: string | undefined
  let txParams: BaseTxParams | undefined

  if (walletNetwork === "solana") {
    unsignedTxBase64 = await buildSolanaWithdrawalUnsignedTx(
      senderAddress, destinationAddress, asset, input.amount
    )
  } else if (walletNetwork === "base") {
    txParams = asset === "ETH"
      ? buildBaseEthTxParams(senderAddress, destinationAddress, input.amount)
      : buildBaseUsdcTxParams(senderAddress, destinationAddress, input.amount)
  }

  return {
    transfer: {
      id: null,
      wallet_id: input.walletId,
      asset,
      network: walletNetwork,
      amount: amountNum,
      destination_address: destinationAddress,
      destination_label: "Direct send",
      status: "PREPARED",
      estimated_fee_label: "wallet will estimate"
    },
    unsignedTxBase64,
    txParams
  }
}

export async function submitSettlementWithdrawal(
  merchantId: string,
  withdrawalId: string,
  txHash: string
): Promise<SettlementWithdrawalRecord> {
  const existing = await import("@/database/settlementWithdrawals")
    .then((m) => m.getSettlementWithdrawal(merchantId, withdrawalId))

  if (!existing) {
    throw Object.assign(new Error("Withdrawal record not found."), { status: 404 })
  }

  if (existing.status !== "PREPARED" && existing.status !== "AWAITING_SIGNATURE") {
    throw Object.assign(
      new Error(`Cannot submit a withdrawal in status: ${existing.status}`),
      { status: 422 }
    )
  }

  const cleanHash = txHash.trim()
  if (!cleanHash) throw Object.assign(new Error("tx_hash is required."), { status: 400 })

  return updateSettlementWithdrawalStatus(merchantId, withdrawalId, "SUBMITTED", {
    txHash: cleanHash,
    submittedAt: new Date().toISOString()
  })
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export async function cancelSettlementWithdrawal(
  merchantId: string,
  withdrawalId: string
): Promise<SettlementWithdrawalRecord> {
  const existing = await import("@/database/settlementWithdrawals")
    .then((m) => m.getSettlementWithdrawal(merchantId, withdrawalId))

  if (!existing) {
    throw Object.assign(new Error("Withdrawal record not found."), { status: 404 })
  }

  const cancellable = ["DRAFT", "PREPARED", "AWAITING_SIGNATURE"]
  if (!cancellable.includes(existing.status)) {
    throw Object.assign(
      new Error(`Cannot cancel a withdrawal in status: ${existing.status}`),
      { status: 422 }
    )
  }

  return updateSettlementWithdrawalStatus(merchantId, withdrawalId, "CANCELLED")
}

// ─── Confirmation status check ────────────────────────────────────────────────

/**
 * Check on-chain status for a SUBMITTED withdrawal and update the DB record.
 * - confirmed → mark CONFIRMED with confirmed_at
 * - failed    → mark FAILED with failure_reason
 * - pending   → return the record unchanged (caller shows "still waiting")
 *
 * Never marks a withdrawal confirmed unless chain RPC says confirmed/finalized.
 */
export async function checkSettlementWithdrawalStatus(
  merchantId: string,
  withdrawalId: string
): Promise<{ withdrawal: SettlementWithdrawalRecord; chainStatus: "confirmed" | "failed" | "pending" }> {
  const { getSettlementWithdrawal } = await import("@/database/settlementWithdrawals")
  const { checkBaseTxStatus, checkSolanaTxStatus } = await import("@/engine/settlementBalances")

  const withdrawal = await getSettlementWithdrawal(merchantId, withdrawalId)
  if (!withdrawal) {
    throw Object.assign(new Error("Withdrawal record not found."), { status: 404 })
  }

  if (withdrawal.status !== "SUBMITTED") {
    throw Object.assign(
      new Error(`Cannot check status of a withdrawal in status: ${withdrawal.status}`),
      { status: 422 }
    )
  }

  const txHash = withdrawal.tx_hash?.trim()
  if (!txHash) {
    throw Object.assign(new Error("No transaction hash recorded for this withdrawal."), { status: 422 })
  }

  const network = withdrawal.network.toLowerCase()

  let chainStatus: "confirmed" | "failed" | "pending"
  if (network === "base") {
    chainStatus = await checkBaseTxStatus(txHash)
  } else if (network === "solana") {
    chainStatus = await checkSolanaTxStatus(txHash)
  } else {
    // Unknown network — can't verify, return as-is
    return { withdrawal, chainStatus: "pending" }
  }

  if (chainStatus === "confirmed") {
    const updated = await updateSettlementWithdrawalStatus(merchantId, withdrawalId, "CONFIRMED", {
      confirmedAt: new Date().toISOString()
    })
    return { withdrawal: updated, chainStatus }
  }

  if (chainStatus === "failed") {
    const updated = await updateSettlementWithdrawalStatus(merchantId, withdrawalId, "FAILED", {
      failureReason: "Transaction failed on chain."
    })
    return { withdrawal: updated, chainStatus }
  }

  // Still pending — return unchanged
  return { withdrawal, chainStatus: "pending" }
}

// ─── History ──────────────────────────────────────────────────────────────────

export async function getSettlementWithdrawalHistory(
  merchantId: string,
  options?: { limit?: number }
): Promise<SettlementWithdrawalRecord[]> {
  return listSettlementWithdrawalsForMerchant(merchantId, options)
}
