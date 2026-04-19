/**
 * PineTree Engine — Cash Sale Recording
 *
 * Handles the full lifecycle of a POS cash sale:
 *   1. Logs the drawer entry (source of truth for cash)
 *   2. Creates a CONFIRMED payment record (makes the sale visible in the dashboard)
 *   3. Creates a CONFIRMED transaction record (ties into reporting)
 *
 * All three writes run in parallel so the API route stays fast.
 * Extracted here so that the API route is a thin request/response shim
 * and all business logic lives in the engine layer.
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
  const merchantAmount = saleTotal - serviceFee

  const paymentId = crypto.randomUUID()
  const transactionId = crypto.randomUUID()

  // Run all inserts in parallel. The drawer log is the authoritative cash record;
  // the payment + transaction + ledger records make the sale visible on the dashboard.
  const [entry] = await Promise.all([
    logCashSale(terminalId, merchantId, saleTotal, cashTendered, changeGiven),
    createPayment({
      id: paymentId,
      merchant_id: merchantId,
      merchant_amount: merchantAmount > 0 ? merchantAmount : saleTotal,
      pinetree_fee: serviceFee,
      gross_amount: saleTotal,
      currency: "USD",
      provider: "cash",
      status: "CONFIRMED",
      metadata: { channel: "pos", terminalId, subtotalAmount, cashTendered, changeGiven }
    }),
    createTransaction({
      id: transactionId,
      payment_id: paymentId,
      merchant_id: merchantId,
      provider: "cash",
      channel: "pos",
      total_amount: saleTotal,
      subtotal_amount: subtotalAmount,
      platform_fee: serviceFee,
      status: "CONFIRMED"
    }),
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
