import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const { chargeId, merchant_id } = await req.json();

    if (!chargeId || !merchant_id) {
      return NextResponse.json(
        { error: "Missing chargeId or merchant_id" },
        { status: 400 }
      );
    }

    // 🔹 Create Supabase client (server-side)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 🔹 Fetch transaction from your ledger
    const { data: transaction, error } = await supabase
      .from("transactions")
      .select("status, total_amount, currency, completed_at")
      .eq("provider_transaction_id", chargeId)
      .eq("merchant_id", merchant_id)
      .single();

    if (error || !transaction) {
      return NextResponse.json(
        { error: "Transaction not found" },
        { status: 404 }
      );
    }

    // 🔹 Return clean status response
    return NextResponse.json({
      status: transaction.status,
      total_amount: transaction.total_amount,
      currency: transaction.currency,
      completed_at: transaction.completed_at,
    });

  } catch (err) {
    console.error("Check charge error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}