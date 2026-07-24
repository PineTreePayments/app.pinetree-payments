import { getActivePaymentsByNetwork } from "@/database/payments"
import type { Payment } from "@/database/payments"
import { processPaymentEvent } from "@/engine/eventProcessor"
import { runPaymentDetectForPayment } from "@/engine/paymentDetect"
import { StoredPaymentSplitMetadata } from "@/types/payment"

function isEvmTxHash(value: unknown): value is string {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || "").trim())
}

export async function processAlchemyWebhook(input: {
  network: "base" | "solana"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  activities: any[]
}): Promise<{ checked: number; matched: number }> {
  const { network, activities } = input

  const active = await getActivePaymentsByNetwork(network, 50)

  const walletToPayment = new Map<string, (typeof active)[0]>()
  // Every payment whose merchantWallet/pinetreeWallet normalizes to a given
  // key, in candidate-selection order — used only to detect when the
  // single-payment lookup above is ambiguous (e.g. two concurrent active
  // contract_split payments sharing the same merchant or shared PineTree
  // treasury wallet) before treating a webhook's txHash as evidence for a
  // specific payment. walletToPayment itself keeps its existing last-write-
  // wins behavior unchanged for the non-contract_split path below.
  const walletToCandidates = new Map<string, Payment[]>()
  const normalizeKey = network === "base"
    ? (s: string) => s.toLowerCase()
    : (s: string) => s

  for (const payment of active) {
    const split = ((payment.metadata ?? null) as StoredPaymentSplitMetadata | null)?.split
    for (const wallet of [split?.merchantWallet, split?.pinetreeWallet]) {
      if (!wallet) continue
      const key = normalizeKey(wallet)
      walletToPayment.set(key, payment)
      const candidates = walletToCandidates.get(key) ?? []
      if (!candidates.some((p) => p.id === payment.id)) candidates.push(payment)
      walletToCandidates.set(key, candidates)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let results: PromiseSettledResult<any>[]

  if (network === "base") {
    results = await Promise.allSettled(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activities.map(async (activity: any) => {
        const toAddress = activity.toAddress?.toLowerCase()
        if (!toAddress) return

        const payment = walletToPayment.get(toAddress)
        if (!payment) return

        // contract_split payments require paymentRef verification before any status
        // advancement. The Alchemy ADDRESS_ACTIVITY webhook matches by wallet address
        // only — it carries no on-chain PaymentSplit log or paymentRef to verify
        // against on its own, so this candidate must never be confirmed directly
        // from the webhook (an address match alone cannot distinguish this payment
        // from any other active payment sharing the same merchant or shared PineTree
        // treasury wallet).
        //
        // The webhook's txHash is still real, valuable evidence though — instead of
        // discarding it, hand it to the exact same authoritative pipeline the
        // customer-facing POST /detect route uses (runPaymentDetectForPayment →
        // ensurePaymentFresh → runPaymentWatcher → watchPaymentOnce's txHash-first
        // contract_split path): persist it as provider_transaction_id, then verify
        // via eth_getTransactionReceipt + decode the on-chain PaymentSplit log +
        // check paymentRef === paymentId + merchant/fee amount thresholds. Only that
        // decoded, on-chain paymentRef match can ever confirm a contract_split
        // payment — never this address-only candidate selection.
        const split = ((payment.metadata ?? null) as StoredPaymentSplitMetadata | null)?.split
        const feeCaptureMethod = String(split?.feeCaptureMethod || "").trim().toLowerCase()
        if (feeCaptureMethod === "contract_split") {
          const txHash = activity.hash
          if (!isEvmTxHash(txHash)) {
            console.info("[alchemyWebhook] base_webhook_contract_split_no_txhash", {
              paymentId: payment.id,
              paymentStatus: payment.status,
              toAddress,
              feeCaptureMethod,
              reason: "no usable transaction hash on this activity — nothing to verify yet"
            })
            return
          }

          // Refuse to guess which payment a shared wallet's activity belongs to.
          // The downstream paymentRef check is authoritative and would reject a
          // wrong guess safely anyway, but persisting a webhook-supplied hash
          // against an arbitrary payment when the candidate is ambiguous is
          // exactly the "confirm by address-only matching" failure mode this
          // path must avoid.
          const candidates = walletToCandidates.get(toAddress) ?? []
          if (candidates.length > 1) {
            console.warn("[alchemyWebhook] base_webhook_ambiguous_candidate_skipped", {
              toAddress,
              txHash,
              candidateCount: candidates.length,
              candidatePaymentIds: candidates.map((p) => p.id),
              reason: "multiple active contract_split payments share this wallet address — refusing to guess which payment this evidence belongs to"
            })
            return
          }

          console.info("[alchemyWebhook] base_webhook_contract_split_evidence_received", {
            paymentId: payment.id,
            paymentStatus: payment.status,
            toAddress,
            txHash,
            feeCaptureMethod,
            reason: "treating webhook txHash as unverified evidence — routing through the authoritative receipt/PaymentSplit verification path"
          })

          const result = await runPaymentDetectForPayment(payment.id, { txHash })

          console.info("[alchemyWebhook] base_webhook_contract_split_verification_completed", {
            paymentId: payment.id,
            txHash,
            httpStatus: result.httpStatus,
            detected: result.body.detected ?? null,
            status: result.body.status ?? null
          })
          return
        }

        await processPaymentEvent({
          type: "payment.confirmed",
          paymentId: payment.id,
          txHash: activity.hash,
          value: activity.value !== undefined ? String(activity.value) : undefined,
          from: activity.fromAddress,
          feeCaptureValidated: false
        })
      })
    )
  } else {
    results = await Promise.allSettled(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activities.flatMap((activity: any) => {
        const txHash = activity.signature
        const transfers: { fromUserAccount?: string; toUserAccount?: string; amount?: number }[] = [
          ...(activity.nativeTransfers ?? []),
          ...(activity.tokenTransfers ?? [])
        ]

        return transfers.map(async (transfer) => {
          const toAccount = transfer.toUserAccount
          if (!toAccount) return

          const payment = walletToPayment.get(toAccount)
          if (!payment) return

          await processPaymentEvent({
            type: "payment.confirmed",
            paymentId: payment.id,
            txHash,
            value: transfer.amount !== undefined ? String(transfer.amount) : undefined,
            from: transfer.fromUserAccount,
            feeCaptureValidated: false
          })
        })
      })
    )
  }

  return {
    checked: activities.length,
    matched: results.filter((r) => r.status === "fulfilled").length
  }
}
