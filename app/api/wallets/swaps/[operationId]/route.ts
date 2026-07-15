import { type NextRequest } from "next/server"
import { withWalletMerchant } from "@/lib/api/walletApiRoute"
import { getWalletSwap } from "@/engine/wallet/walletOperations"

export async function GET(req: NextRequest, context: { params: Promise<{ operationId: string }> }) {
  const { operationId } = await context.params
  return withWalletMerchant(req, async (merchantId) => getWalletSwap(merchantId, operationId))
}
