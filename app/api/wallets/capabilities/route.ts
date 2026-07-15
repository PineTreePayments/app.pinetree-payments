import { type NextRequest } from "next/server"
import { withWalletMerchant } from "@/lib/api/walletApiRoute"
import { getWalletCapabilities } from "@/engine/wallet/walletOperations"

export async function GET(req: NextRequest) {
  return withWalletMerchant(req, async (merchantId) => getWalletCapabilities(merchantId))
}
