import { NextRequest, NextResponse } from "next/server"
import {
  getOffRampQuoteForMerchant,
  type OffRampAsset,
  type OffRampNetwork,
  type OffRampProvider
} from "@/engine/offRampOperations"
import { OffRampProviderError } from "@/providers/offramp/types"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

type OffRampQuoteBody = {
  provider?: OffRampProvider
  network?: OffRampNetwork
  asset?: OffRampAsset
  amount?: number | string
  fiatCurrency?: string
  payoutMethod?: string | null
  sourceWalletAddress?: string | null
  refundWalletAddress?: string | null
  merchantState?: string | null
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function getQuoteStatus(error: unknown) {
  if (error instanceof OffRampProviderError) return error.status
  const message = getErrorMessage(error, "")
  if (
    message === "Invalid off-ramp amount" ||
    message === "Missing merchant ID" ||
    message.includes("Unsupported off-ramp")
  ) {
    return 400
  }
  return getRouteErrorStatus(error)
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json().catch(() => null)) as OffRampQuoteBody | null

    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const result = await getOffRampQuoteForMerchant({
      merchantId,
      provider: body.provider || "moonpay",
      network: body.network as OffRampNetwork,
      asset: body.asset as OffRampAsset,
      amount: Number(body.amount),
      fiatCurrency: body.fiatCurrency || "USD",
      payoutMethod: body.payoutMethod || "ach_bank_transfer",
      sourceWalletAddress: body.sourceWalletAddress || null,
      refundWalletAddress: body.refundWalletAddress || null,
      merchantState: body.merchantState || null
    })

    const status = result.quote
      ? 200
      : result.support.supported && !result.providerCallsEnabled
        ? 503
        : 400

    return NextResponse.json(
      {
        success: Boolean(result.quote),
        session: result.session,
        quote: result.quote,
        support: result.support,
        providerCallsEnabled: result.providerCallsEnabled,
        fundMovementEnabled: false
      },
      { status }
    )
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to prepare off-ramp quote") },
      { status: getQuoteStatus(error) }
    )
  }
}
