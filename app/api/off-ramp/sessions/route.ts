import { NextRequest, NextResponse } from "next/server"
import {
  createOffRampSessionDraftForMerchant,
  listOffRampSessionsForMerchant,
  type OffRampAsset,
  type OffRampNetwork,
  type OffRampProvider
} from "@/engine/offRampOperations"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

type CreateOffRampSessionBody = {
  provider?: OffRampProvider
  network?: OffRampNetwork
  asset?: OffRampAsset
  amount?: number | string
  sourceWalletAddress?: string | null
  refundWalletAddress?: string | null
  payoutMethod?: string | null
  merchantState?: string | null
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function getOffRampErrorStatus(error: unknown) {
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

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const sessions = await listOffRampSessionsForMerchant(merchantId)

    return NextResponse.json({
      success: true,
      sessions
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to load off-ramp sessions") },
      { status: getRouteErrorStatus(error) }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json().catch(() => null)) as CreateOffRampSessionBody | null

    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const result = await createOffRampSessionDraftForMerchant({
      merchantId,
      provider: body.provider || "moonpay",
      network: body.network as OffRampNetwork,
      asset: body.asset as OffRampAsset,
      amount: Number(body.amount),
      sourceWalletAddress: body.sourceWalletAddress || null,
      refundWalletAddress: body.refundWalletAddress || null,
      payoutMethod: body.payoutMethod || null,
      merchantState: body.merchantState || null,
      providerSetupActive: false
    })

    return NextResponse.json(
      {
        success: !result.rejected,
        session: result.session,
        support: result.support,
        providerCallsEnabled: false,
        fundMovementEnabled: false
      },
      { status: result.rejected ? 400 : 201 }
    )
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to create off-ramp session draft") },
      { status: getOffRampErrorStatus(error) }
    )
  }
}
