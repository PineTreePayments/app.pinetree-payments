import { type NextRequest } from "next/server"
import { withWalletMerchant, requireIdempotencyKey, readWalletJsonBody } from "@/lib/api/walletApiRoute"
import { createWalletWithdrawal } from "@/engine/wallet/walletOperations"

export async function POST(req: NextRequest) {
  return withWalletMerchant(req, async (merchantId) => {
    const idempotencyKey = requireIdempotencyKey(req)
    const body = await readWalletJsonBody(req)

    return createWalletWithdrawal(merchantId, {
      asset: String(body.asset || ""),
      amountDecimal: String(body.amount_decimal || body.amountDecimal || ""),
      destination: String(body.destination || ""),
      note: typeof body.note === "string" ? body.note : undefined,
      idempotencyKey,
    })
  })
}
