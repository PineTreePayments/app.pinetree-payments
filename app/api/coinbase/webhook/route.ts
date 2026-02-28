import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const event = await req.json();

    const charge = event?.event?.data;

    if (!charge?.id) {
      return NextResponse.json({ received: false }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const timeline = charge.timeline || [];
    const latestStatus = timeline[timeline.length - 1]?.status;

    if (latestStatus === "CONFIRMED") {
      await supabase
        .from("transactions")
        .update({
          status: "confirmed",
          completed_at: new Date().toISOString(),
        })
        .eq("provider_transaction_id", charge.id);
    }

    if (latestStatus === "FAILED" || latestStatus === "EXPIRED") {
      await supabase
        .from("transactions")
        .update({
          status: "failed",
        })
        .eq("provider_transaction_id", charge.id);
    }

    return NextResponse.json({ received: true });

  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Webhook failed" }, { status: 500 });
  }
}