import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    console.log("🔥 WEBHOOK HIT");

    const body = await request.json();
    console.log("RAW BODY:", JSON.stringify(body, null, 2));

    const eventType = body?.type;
    const eventId = body?.id;
    const chargeId = body?.data?.id;

    console.log("EVENT TYPE:", eventType);
    console.log("EVENT ID:", eventId);
    console.log("CHARGE ID:", chargeId);

    if (!eventType) {
      console.log("❌ No event type found");
      return NextResponse.json({ received: true });
    }

    switch (eventType) {
      case "charge:created":
        console.log("🆕 Charge Created:", chargeId);
        break;

      case "charge:pending":
        console.log("⏳ Charge Pending:", chargeId);
        break;

      case "charge:confirmed":
        console.log("✅ Charge Confirmed:", chargeId);
        break;

      case "charge:failed":
        console.log("❌ Charge Failed:", chargeId);
        break;

      default:
        console.log("ℹ️ Other event:", eventType);
    }

    return NextResponse.json({ received: true });

  } catch (error) {
    console.error("❌ WEBHOOK ERROR:", error);
    return NextResponse.json({ error: "Webhook failed" }, { status: 500 });
  }
}