import { type NextRequest } from "next/server"
import { withWalletMerchant, requireIdempotencyKey } from "@/lib/api/walletApiRoute"
import { createWalletSwap } from "@/engine/wallet/walletOperations"

export async function POST(req: NextRequest) {
  return withWalletMerchant(req, async (merchantId) => {
    const idempotencyKey = requireIdempotencyKey(req)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    return createWalletSwap(merchantId, {
      sourceAsset: String(body.source_asset || body.sourceAsset || ""),
      targetAsset: String(body.target_asset || body.targetAsset || ""),
      amountDecimal: String(body.amount_decimal || body.amountDecimal || ""),
      idempotencyKey,
    })
  })
}
