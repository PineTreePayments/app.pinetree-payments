import { NextResponse } from "next/server"
import { runValidationMerchantInsertEngine } from "@/engine/adminValidation"

export async function POST() {
  try {
    const data = await runValidationMerchantInsertEngine()
    return NextResponse.json({ data }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Validation insert failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}