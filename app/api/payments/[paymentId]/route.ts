import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ paymentId: string }> }
) {
  try {
    const { paymentId } = await context.params

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .single()

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ payment: data })

  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}