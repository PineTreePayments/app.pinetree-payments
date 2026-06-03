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

const VALID_PROVIDERS: OffRampProvider[] = ["moonpay", "ramp", "banxa", "transak"]
const VALID_NETWORKS:  OffRampNetwork[]  = ["base", "solana", "lightning"]
const VALID_ASSETS:    OffRampAsset[]    = ["ETH", "USDC", "SOL", "BTC"]

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json().catch(() => null)) as CreateOffRampSessionBody | null

    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const provider = (body.provider || "moonpay") as OffRampProvider
    const network  = body.network  as OffRampNetwork | undefined
    const asset    = body.asset    as OffRampAsset   | undefined
    const amount   = Number(body.amount)

    if (!VALID_PROVIDERS.includes(provider)) {
      return NextResponse.json(
        { error: `Invalid provider. Allowed: ${VALID_PROVIDERS.join(", ")}` },
        { status: 400 }
      )
    }
    if (!network || !VALID_NETWORKS.includes(network)) {
      return NextResponse.json(
        { error: `Invalid or missing network. Allowed: ${VALID_NETWORKS.join(", ")}` },
        { status: 400 }
      )
    }
    if (!asset || !VALID_ASSETS.includes(asset)) {
      return NextResponse.json(
        { error: `Invalid or missing asset. Allowed: ${VALID_ASSETS.join(", ")}` },
        { status: 400 }
      )
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "amount must be a positive number" },
        { status: 400 }
      )
    }

    const result = await createOffRampSessionDraftForMerchant({
      merchantId,
      provider,
      network,
      asset,
      amount,
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
