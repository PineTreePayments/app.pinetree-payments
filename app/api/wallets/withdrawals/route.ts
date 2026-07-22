import { type NextRequest } from "next/server"
import { withWalletMerchant, requireIdempotencyKey, readWalletJsonBody } from "@/lib/api/walletApiRoute"
import { createWalletWithdrawal } from "@/engine/wallet/walletOperations"
import { updateWalletOperationCanonicalFields } from "@/database/merchantWalletOperations"
import { submitCanonicalWithdrawal } from "@/engine/withdrawals/canonicalWithdrawal"
import { getDeploymentBuildId } from "@/lib/deploymentInfo"
import { classifyBitcoinWithdrawalDestination } from "@/providers/wallets/bitcoinWithdrawalDestination"

export async function POST(req: NextRequest) {
  const correlationId = req.headers?.get("x-pinetree-withdrawal-correlation") || null
  const buildId = getDeploymentBuildId()
  return withWalletMerchant(req, async (merchantId) => {
    const idempotencyKey = requireIdempotencyKey(req)
    const body = await readWalletJsonBody(req)
    const destinationId = body.destination_id !== undefined ? String(body.destination_id) : undefined
    console.info("[pinetree-withdrawals] SPEED_SUBMIT_RECEIVED", {
      correlationId, merchantId, asset: body.asset ?? "SATS", hasDestinationId: Boolean(destinationId), buildId, routeStage: "submit_received",
    })

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
      const write = canonical.kind === "executed" ? canonical.write : canonical
      console.info("[pinetree-withdrawals] SPEED_SUBMIT_RETURNED", {
        correlationId, merchantId, buildId, routeStage: "submit_returned",
        status: canonical.kind === "executed" ? canonical.write.operation.status : null,
      })
      return write
    }

    const destination = String(body.destination || "")
    const classifiedDestination = classifyBitcoinWithdrawalDestination(destination)
    console.info("[pinetree-withdrawals] SPEED_DESTINATION_CLASSIFIED", {
      correlationId,
      merchantId,
      buildId,
      routeStage: "destination_classified",
      destinationMethod: classifiedDestination.valid ? classifiedDestination.method : "invalid",
      destinationType: classifiedDestination.valid ? classifiedDestination.kind : "invalid",
    })
    const result = await createWalletWithdrawal(merchantId, {
      asset: String(body.asset || ""),
      amountDecimal: String(body.amount_decimal || body.amountDecimal || ""),
      destination,
      note: typeof body.note === "string" ? body.note : undefined,
      idempotencyKey,
      correlationId,
    })

    // Stamps this row as a plain manual (freely-typed address) withdrawal for
    // Activity/reporting parity with saved-address and automatic-sweep
    // withdrawals, which both go through engine/withdrawals/canonicalWithdrawal.ts.
    // Best-effort, and deliberately not part of the returned response shape -
    // this generic, provider-agnostic route's contract stays unchanged.
    void updateWalletOperationCanonicalFields(merchantId, result.operation.id, { source: "manual" }).catch(() => {})

    console.info("[pinetree-withdrawals] SPEED_SUBMIT_RETURNED", {
      correlationId, merchantId, buildId, routeStage: "submit_returned", status: result.operation.status,
    })
    return result
  }, { correlationId })
}
