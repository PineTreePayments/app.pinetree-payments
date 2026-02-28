import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  try {
    console.log("🔥 WEBHOOK HIT");

    const rawBody = await request.text();
    const body = JSON.parse(rawBody);

    const event = body.event ?? body;

    const eventType = event?.type;
    const chargeId = event?.data?.id;

    console.log("EVENT TYPE:", eventType);
    console.log("CHARGE ID:", chargeId);

    if (!eventType || !chargeId) {
      console.log("❌ Missing event type or charge ID");
      return NextResponse.json({ received: true });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    if (eventType === "charge:confirmed") {
      console.log("✅ Updating transaction to CONFIRMED");

      const { error } = await supabase
        .from("transactions")
        .update({ status: "confirmed" })
        .eq("provider_transaction_id", chargeId);

      if (error) {
        console.log("❌ Supabase update error:", error.message);
      }
    }

    if (eventType === "charge:failed") {
      console.log("❌ Updating transaction to FAILED");

      await supabase
        .from("transactions")
        .update({ status: "failed" })
        .eq("provider_transaction_id", chargeId);
    }

    return NextResponse.json({ received: true });

  } catch (error) {
    console.error("❌ WEBHOOK ERROR:", error);
    return NextResponse.json({ error: "Webhook failed" }, { status: 500 });
  }
}