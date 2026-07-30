import { type NextRequest, NextResponse } from "next/server"
import { estimateMaxWithdrawalAmount } from "@/engine/withdrawals/withdrawalFeeEstimate"
import { normalizeWithdrawalRail, normalizeWithdrawalAsset } from "@/engine/withdrawals/walletWithdrawals"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { presentWithdrawalError } from "@/engine/withdrawals/withdrawalErrorPresentation"
import type { WalletApiErrorCode } from "@/engine/wallet/walletErrors"
import { isSupportedWithdrawalPair } from "@/engine/withdrawals/withdrawalAccounting"

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json()) as Record<string, unknown>
    const rail = normalizeWithdrawalRail(String(body.rail || ""))
    const asset = normalizeWithdrawalAsset(String(body.asset || ""))

    if (!rail || !asset || !isSupportedWithdrawalPair(rail, asset)) {
      return NextResponse.json({ error: "Unsupported rail or asset." }, { status: 400 })
    }

    const destinationAddress = typeof body.destination_address === "string" ? body.destination_address.trim() : ""
    if (rail === "solana" && asset === "USDC" && !destinationAddress) {
      return NextResponse.json(
        { error: "A Solana destination is required to estimate token-account rent." },
        { status: 400 }
      )
    }
    if (
      rail === "bitcoin" &&
      body.bitcoin_method !== undefined &&
      body.bitcoin_method !== "onchain" &&
      body.bitcoin_method !== "lightning"
    ) {
      return NextResponse.json({ error: "Unsupported Bitcoin withdrawal method." }, { status: 400 })
    }
    const bitcoinMethod = body.bitcoin_method === "onchain" || body.bitcoin_method === "lightning"
      ? body.bitcoin_method
      : undefined
    const estimate = await estimateMaxWithdrawalAmount(merchantId, rail, asset, {
      ...(destinationAddress ? { destinationAddress } : {}),
      ...(bitcoinMethod ? { bitcoinMethod } : {}),
    })
    return NextResponse.json({ estimate })
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "") as WalletApiErrorCode
      : undefined
    const presented = presentWithdrawalError({
      code,
      rawMessage: error instanceof Error ? error.message : "Failed to estimate maximum withdrawal amount",
    })
    return NextResponse.json({ error: presented.message, error_code: presented.code }, { status: getRouteErrorStatus(error) })
  }
}
