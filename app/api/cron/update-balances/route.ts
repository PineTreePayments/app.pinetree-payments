import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabaseClient"

export async function GET() {
  try {

    /* 1. GET ALL ACTIVE WALLETS */

    const { data: providers, error } = await supabase
      .from("merchant_providers")
      .select("*")
      .eq("status", "active")

    if (error) {
      throw error
    }

    /* 2. LOOP THROUGH WALLETS */

    for (const provider of providers) {

      const walletAddress = provider.credentials?.wallet
      const network = provider.provider

      if (!walletAddress || !network) continue

      try {

        /* 3. CALL YOUR EXISTING API */

        const res = await fetch(
          `${process.env.NEXT_PUBLIC_APP_URL}/api/wallet-balance`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              address: walletAddress,
              network,
            }),
          }
        )

        const json = await res.json()
        const balance = json.balance ?? 0

        /* 4. STORE IN DB */

        await supabase
          .from("wallet_balances")
          .upsert({
            merchant_id: provider.merchant_id,
            asset: network.toUpperCase(),
            balance,
            last_updated: new Date().toISOString(),
          })

      } catch (err) {
        console.error("Balance update failed:", err)
      }
    }

    return NextResponse.json({ success: true })

  } catch (err) {
    console.error("cron error:", err)
    return NextResponse.json({ success: false })
  }
}