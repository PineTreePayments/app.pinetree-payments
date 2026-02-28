import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const { amount, merchant_id } = await req.json();

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY! // server-only key
    );

    console.log("Incoming merchant_id:", merchant_id);

    // 🔹 Get merchant's stored Coinbase key
    const { data: merchant, error: merchantError } = await supabase
      .from("merchant_settings")
      .select("coinbase_api_key")
      .eq("merchant_id", merchant_id)
      .single();

      console.log("Merchant query result:", merchant);
      console.log("Merchant query error:", merchantError);

    if (merchantError || !merchant?.coinbase_api_key) {
      return NextResponse.json(
        { error: "Merchant API key not found" },
        { status: 400 }
      );
    }

    // 🔹 Create Coinbase charge using merchant's key
    const response = await fetch("https://api.commerce.coinbase.com/charges", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CC-Api-Key": merchant.coinbase_api_key,
        "X-CC-Version": "2018-03-22",
      },
      body: JSON.stringify({
        name: "PineTree Payment",
        description: "Point of Sale Transaction",
        pricing_type: "fixed_price",
        local_price: {
          amount: (amount / 100).toFixed(2),
          currency: "USD",
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json({ error: data }, { status: 400 });
    }

    const charge = data.data;

    // 🔹 Calculate fee breakdown
   const platformFee = 5;
const subtotal = amount;
const total = amount + platformFee;

const { error: insertError } = await supabase
  .from("transactions")
  .insert({
    merchant_id,
    provider: "coinbase",
    provider_transaction_id: charge.id,
    subtotal_amount: subtotal,
    platform_fee: platformFee,
    total_amount: total,
    currency: "USD",
    status: "pending",
  });

if (insertError) {
  console.error("Supabase insert error:", insertError);
  return NextResponse.json(
    { error: insertError.message },
    { status: 500 }
  );
}

    // 🔹 Return hosted checkout URL
    return NextResponse.json({
      hosted_url: charge.hosted_url,
      charge_id: charge.id,
    });

  } catch (error) {
    console.error("Charge creation error:", error);
    return NextResponse.json(
      { error: "Charge creation failed" },
      { status: 500 }
    );
  }
}