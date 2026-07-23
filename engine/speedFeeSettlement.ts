/**
 * Records realized Speed APPLICATION_FEE transfer evidence once a
 * connect-split Bitcoin Lightning payment is confirmed paid.
 *
 * `createSpeedLightningPayment` (providers/lightning/speedClient.ts) already
 * records "transfer_created"/"missing"/"not_applicable"/"retained_pending_sweep"
 * at invoice-creation time from Speed's create-payment response. This module
 * is the only place that ever writes the final "settled" state, and it does
 * so exclusively from a `transfers[]` entry carrying both
 * `created_type: "APPLICATION_FEE"` and a `transfer_id` - the same evidence
 * Speed's official documentation shows only appears once a payment is paid.
 *
 * Both call sites (the raw webhook path in engine/eventProcessor.ts and the
 * polling path in engine/lightningSpeedReconciliation.ts) only reach this
 * function once per payment: each already guards on the payment's terminal
 * status before advancing to CONFIRMED, so a redelivered/duplicate
 * payment.paid webhook never reaches here a second time. The
 * PRE_SETTLEMENT_STATUSES guard below is a second, independent safety net -
 * it also means this function only ever acts on payments that were created
 * expecting a connect-split fee, never on treasury-sweep or zero-fee payments.
 */
import { getPaymentById, updatePaymentMetadata } from "@/database/payments"

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

type TransferLike = {
  created_type?: string | null
  transfer_id?: string | null
  destination_account?: string | null
}

function findRealizedApplicationFeeTransfer(transfers: unknown): TransferLike | null {
  if (!Array.isArray(transfers)) return null
  const match = transfers.find((entry) => {
    const row = readRecord(entry)
    return (
      String(row.created_type || "").toUpperCase() === "APPLICATION_FEE" &&
      Boolean(row.transfer_id)
    )
  })
  return (match as TransferLike | undefined) ?? null
}

// Only a payment created expecting a connect-split fee (application_fee sent)
// can transition to "settled"/"missing" here. "not_applicable" (no fee owed)
// and "retained_pending_sweep" (treasury-sweep mode) are never touched -
// there is no Speed application_fee transfer to look for on those payments.
const PRE_SETTLEMENT_STATUSES = new Set(["transfer_created", "missing"])

export async function recordSpeedApplicationFeeSettlement(
  paymentId: string,
  transfers: unknown
): Promise<void> {
  const payment = await getPaymentById(paymentId)
  if (!payment) return

  const metadata = readRecord(payment.metadata)
  const split = readRecord(metadata.split)
  const lightningProviderMetadata = readRecord(split.lightningProviderMetadata)
  const currentStatus = String(lightningProviderMetadata.feeSettlementStatus || "")

  if (!PRE_SETTLEMENT_STATUSES.has(currentStatus)) return

  const transfer = findRealizedApplicationFeeTransfer(transfers)
  const update = transfer
    ? {
        feeSettlementStatus: "settled" as const,
        applicationFeeTransferId: String(transfer.transfer_id),
        applicationFeeTransferDestinationAccount:
          transfer.destination_account != null ? String(transfer.destination_account) : null,
      }
    : { feeSettlementStatus: "missing" as const }

  await updatePaymentMetadata(paymentId, {
    split: {
      ...split,
      lightningProviderMetadata: {
        ...lightningProviderMetadata,
        ...update,
      },
    },
  })

  console.info("[speed] application_fee_settlement_recorded", {
    canonicalTransactionId: paymentId,
    feeSettlementStatus: update.feeSettlementStatus,
    transferIdPresent: Boolean(transfer),
  })
}
