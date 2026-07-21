import { type NextRequest } from "next/server"
import { withWalletMerchant, requireIdempotencyKey, readWalletJsonBody } from "@/lib/api/walletApiRoute"
import { createWalletWithdrawal } from "@/engine/wallet/walletOperations"
import { updateWalletOperationCanonicalFields } from "@/database/merchantWalletOperations"
import { submitCanonicalWithdrawal } from "@/engine/withdrawals/canonicalWithdrawal"

export async function POST(req: NextRequest) {
  return withWalletMerchant(req, async (merchantId) => {
    const idempotencyKey = requireIdempotencyKey(req)
    const body = await readWalletJsonBody(req)
    const destinationId = body.destination_id !== undefined ? String(body.destination_id) : undefined

    // A saved destination was picked - route through the canonical
    // dispatcher (same entrypoint automatic sweeps use) so this withdrawal
    // is correctly stamped source="saved_address" with a point-in-time
    // destination snapshot.
    if (destinationId) {
      const canonical = await submitCanonicalWithdrawal({
        merchantId,
        rail: "bitcoin",
        asset: "BTC",
        amountDecimal: String(body.amount_decimal || body.amountDecimal || ""),
        source: "saved_address",
        idempotencyKey,
        destinationId,
      })
      return canonical.kind === "executed" ? canonical.write : canonical
    }

    const result = await createWalletWithdrawal(merchantId, {
      asset: String(body.asset || ""),
      amountDecimal: String(body.amount_decimal || body.amountDecimal || ""),
      destination: String(body.destination || ""),
      note: typeof body.note === "string" ? body.note : undefined,
      idempotencyKey,
    })

    // Stamps this row as a plain manual (freely-typed address) withdrawal for
    // Activity/reporting parity with saved-address and automatic-sweep
    // withdrawals, which both go through engine/withdrawals/canonicalWithdrawal.ts.
    // Best-effort, and deliberately not part of the returned response shape -
    // this generic, provider-agnostic route's contract stays unchanged.
    void updateWalletOperationCanonicalFields(merchantId, result.operation.id, { source: "manual" }).catch(() => {})

    return result
  })
}
