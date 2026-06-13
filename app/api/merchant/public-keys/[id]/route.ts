import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { disableMerchantPublicKeyEngine } from "@/engine/merchantPublicKeys"

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { id: keyId } = await params
    if (!keyId) {
      return NextResponse.json({ error: "Key ID is required" }, { status: 400 })
    }
    await disableMerchantPublicKeyEngine(keyId, merchantId)
    return NextResponse.json({ ok: true })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to disable public key" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
