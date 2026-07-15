import { type NextRequest } from "next/server"
import { withWalletMerchant } from "@/lib/api/walletApiRoute"
import { quoteWalletSwap } from "@/engine/wallet/walletOperations"

export async function POST(req: NextRequest) {
  return withWalletMerchant(req, async (merchantId) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    return quoteWalletSwap(merchantId, {
      sourceAsset: String(body.source_asset || body.sourceAsset || ""),
      targetAsset: String(body.target_asset || body.targetAsset || ""),
      amountDecimal: String(body.amount_decimal || body.amountDecimal || ""),
    })
  })
}
