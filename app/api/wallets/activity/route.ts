import { type NextRequest } from "next/server"
import { withWalletMerchant } from "@/lib/api/walletApiRoute"
import { getWalletActivity } from "@/engine/wallet/walletOperations"
import type { WalletOperationStatus, WalletOperationType } from "@/database/merchantWalletOperations"

const VALID_TYPES = new Set<WalletOperationType>([
  "PAYMENT",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "WITHDRAWAL",
  "PAYOUT",
  "SWAP_IN",
  "SWAP_OUT",
  "APPLICATION_FEE",
  "ADJUSTMENT",
])

const VALID_STATUSES = new Set<WalletOperationStatus>([
  "CREATED",
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "EXPIRED",
  "REQUIRES_ACTION",
])

export async function GET(req: NextRequest) {
  return withWalletMerchant(req, async (merchantId) => {
    const url = new URL(req.url)
    const typeParam = url.searchParams.get("type")?.trim().toUpperCase()
    const statusParam = url.searchParams.get("status")?.trim().toUpperCase()
    const cursor = url.searchParams.get("cursor")
    const limitParam = url.searchParams.get("limit")

    return getWalletActivity(merchantId, {
      type: typeParam && VALID_TYPES.has(typeParam as WalletOperationType) ? (typeParam as WalletOperationType) : undefined,
      status:
        statusParam && VALID_STATUSES.has(statusParam as WalletOperationStatus)
          ? (statusParam as WalletOperationStatus)
          : undefined,
      cursor: cursor || null,
      limit: limitParam ? Number(limitParam) : undefined,
    })
  })
}
