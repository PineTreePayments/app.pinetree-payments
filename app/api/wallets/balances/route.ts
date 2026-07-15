import { type NextRequest } from "next/server"
import { withWalletMerchant } from "@/lib/api/walletApiRoute"
import { getWalletBalances } from "@/engine/wallet/walletOperations"

export async function GET(req: NextRequest) {
  return withWalletMerchant(req, async (merchantId) => getWalletBalances(merchantId))
}
