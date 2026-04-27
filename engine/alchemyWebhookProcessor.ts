import { getActivePaymentsByNetwork } from "@/database/payments"
import { processPaymentEvent } from "@/engine/eventProcessor"
import { StoredPaymentSplitMetadata } from "@/types/payment"

export async function processAlchemyWebhook(input: {
  network: "base" | "solana"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  activities: any[]
}): Promise<{ checked: number; matched: number }> {
  const { network, activities } = input

  const active = await getActivePaymentsByNetwork(network, 50)

  const walletToPayment = new Map<string, (typeof active)[0]>()
  const normalizeKey = network === "base"
    ? (s: string) => s.toLowerCase()
    : (s: string) => s

  for (const payment of active) {
    const split = ((payment.metadata ?? null) as StoredPaymentSplitMetadata | null)?.split
    if (split?.merchantWallet) {
      walletToPayment.set(normalizeKey(split.merchantWallet), payment)
    }
    if (split?.pinetreeWallet) {
      walletToPayment.set(normalizeKey(split.pinetreeWallet), payment)
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
