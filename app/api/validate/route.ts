import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { runValidationMerchantInsertEngine } from "@/engine/adminValidation"

export async function POST(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)
    const data = await runValidationMerchantInsertEngine()
    return NextResponse.json({ data }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Validation insert failed"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}