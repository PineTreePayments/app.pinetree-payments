import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { createMerchantPublicKey, listMerchantPublicKeys } from "@/engine/merchantPublicKeys"

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const keys = await listMerchantPublicKeys(merchantId)
    return NextResponse.json({ keys })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch public keys" },
      { status: getRouteErrorStatus(error) }
    )
  }
}

type CreatePublicKeyBody = {
  name?: string
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json()) as CreatePublicKeyBody

    const key = await createMerchantPublicKey({
      merchantId,
      name: body.name,
    })

    return NextResponse.json({ key }, { status: 201 })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create public key" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
