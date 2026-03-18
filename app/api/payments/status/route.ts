import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/database/supabase"

export async function GET(req: NextRequest) {

  const { searchParams } = new URL(req.url)

  const paymentId = searchParams.get("paymentId")

  if (!paymentId) {
    return NextResponse.json(
      { error: "Missing paymentId" },
      { status: 400 }
    )
  }

  const { data } = await supabase
    .from("payments")
    .select("status")
    .eq("id", paymentId)
    .single()

  if (!data) {
    return NextResponse.json(
      { error: "Payment not found" },
      { status: 404 }
    )
  }

  return NextResponse.json({
    status: data.status
  })

}