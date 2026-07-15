import { type NextRequest } from "next/server"
import { withWalletMerchant } from "@/lib/api/walletApiRoute"
import { getWalletOperation } from "@/engine/wallet/walletOperations"

export async function GET(req: NextRequest, context: { params: Promise<{ operationId: string }> }) {
  const { operationId } = await context.params
  return withWalletMerchant(req, async (merchantId) => getWalletOperation(merchantId, operationId))
}
