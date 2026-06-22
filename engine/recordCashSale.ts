/**
 * PineTree Engine — Cash Sale Recording
 *
 * Handles the full lifecycle of a POS cash sale in strict dependency order:
 *   1. Creates a CONFIRMED payment row (must exist before transaction FK can resolve)
 *   2. Creates a CONFIRMED transaction row (FK references payments.id)
 *   3. Writes ledger entry + drawer log in parallel (both depend on payment; no FK on transaction_id)
 *
 * Sequencing is required: the transactions_payment_id_fkey constraint means the payments
 * row must be committed before the transactions INSERT runs.
 * The drawer log is written last so it only records the sale when persistence succeeds.
 */

import { createPayment } from "@/database/payments"
import { createTransaction } from "@/database/transactions"
import { upsertLedgerEntry } from "@/database/ledgerEntries"
import { logCashSale } from "./cashDrawer"
import type { DrawerEntry } from "@/database/cashDrawer"

export type RecordCashSaleInput = {
  terminalId: string
  merchantId: string
  saleTotal: number
  cashTendered: number
  changeGiven: number
  subtotalAmount?: number
  serviceFee?: number
  taxAmount?: number
  taxRate?: number
}

export type RecordCashSaleResult = {
  entry: DrawerEntry
  paymentId: string
  transactionId: string
}

export async function recordCashSale(input: RecordCashSaleInput): Promise<RecordCashSaleResult> {
  const { terminalId, merchantId, saleTotal, cashTendered, changeGiven } = input
  const subtotalAmount = input.subtotalAmount ?? saleTotal
  const serviceFee = input.serviceFee ?? 0
  const taxAmount = input.taxAmount ?? 0
  const taxRate = input.taxRate ?? 0
  const merchantAmount = saleTotal - serviceFee

  // Step 1: persist the payment row first — the transaction FK requires it to exist.
  const payment = await createPayment({
    id: crypto.randomUUID(),
    merchant_id: merchantId,
    merchant_amount: merchantAmount > 0 ? merchantAmount : saleTotal,
    pinetree_fee: serviceFee,
    gross_amount: saleTotal,
    currency: "USD",
    provider: "cash",
    status: "CONFIRMED",
    metadata: { channel: "pos", terminalId, subtotalAmount, taxAmount, taxRate, serviceFee, cashTendered, changeGiven }
  })

  const paymentId = payment.id
  const transactionId = crypto.randomUUID()

  // Step 2: persist the transaction row — payment row is now committed.
  await createTransaction({
    id: transactionId,
    payment_id: paymentId,
    merchant_id: merchantId,
    provider: "cash",
    network: "cash",
    channel: "pos",
    total_amount: Math.round(saleTotal * 100),
    subtotal_amount: Math.round(subtotalAmount * 100),
    platform_fee: Math.round(serviceFee * 100),
    status: "CONFIRMED"
  })

  // Step 3: ledger entry + drawer log in parallel — both run only after payment + transaction succeed.
  const [entry] = await Promise.all([
    logCashSale(terminalId, merchantId, saleTotal, cashTendered, changeGiven),
    upsertLedgerEntry({
      merchant_id: merchantId,
      payment_id: paymentId,
      transaction_id: transactionId,
      provider: "cash",
      network: "cash",
      asset: "USD",
      amount: saleTotal,
      usd_value: saleTotal,
      wallet_address: "cash",
      direction: "INBOUND",
      status: "CONFIRMED"
    })
  ])

  return { entry, paymentId, transactionId }
}
