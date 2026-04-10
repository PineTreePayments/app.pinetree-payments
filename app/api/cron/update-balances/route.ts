import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function GET() {
  console.log("Cron running every minute - v2")

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const now = new Date().toISOString()

  try {

    /* =========================
       1. UPDATE SYSTEM STATUS
    ========================= */

    try {
      await supabase
        .from("system_status")
        .upsert({
          id: 1,
          last_run: now
        })
    } catch (e) {
      // Ignore system status errors
      console.warn("System status update failed:", e)
    }


    /* =========================
       2. GET ALL WALLETS
    ========================= */

    const { data: wallets, error: walletError } = await supabase
      .from("merchant_wallets")
      .select("*")

    if (walletError) {
      console.error("Wallet fetch error:", walletError)
      return NextResponse.json({ success: false })
    }

    console.log("Wallets found:", wallets?.length)


    /* =========================
       3. LOOP WALLETS
    ========================= */

    for (const wallet of wallets || []) {

      const walletAddress = wallet.wallet_address
      const network = wallet.network

      if (!walletAddress || !network) continue

      let balance = 0

      try {

        /* ===== SOLANA ===== */

        if (network === "solana") {
          const res = await fetch("https://api.mainnet-beta.solana.com", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "getBalance",
              params: [walletAddress],
            }),
          })

          const data = await res.json()
          const lamports = data?.result?.value ?? 0
          balance = lamports / 1_000_000_000
        }

        /* ===== ETH / BASE ===== */

        if (network === "base" || network === "ethereum") {
          const res = await fetch("https://eth.llamarpc.com", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "eth_getBalance",
              params: [walletAddress, "latest"],
            }),
          })

          const data = await res.json()
          const hex = data?.result ?? "0x0"

          try {
            const wei = BigInt(hex)
            balance = Number(wei) / 1e18
          } catch {
            balance = 0
          }
        }

        /* =========================
           4. UPSERT BALANCE (FIXED)
        ========================= */

        const assetName = network === "solana" ? "SOL" : network === "base" ? "ETH" : network.toUpperCase()

        const { error: upsertError } = await supabase
          .from("wallet_balances")
          .upsert(
            {
              merchant_id: wallet.merchant_id,
              asset: assetName,
              balance,
              last_updated: now
            },
            {
              onConflict: "merchant_id,asset"
            }
          )

        if (upsertError) {
          console.error("Upsert error:", upsertError)
        }

        console.log(
          `Updated ${network} wallet ${walletAddress} → ${balance}`
        )

      } catch (err) {
        console.error("Balance fetch failed:", err)
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: now
    })

  } catch (err: any) {
    console.error("Cron fatal error:", err)

    return NextResponse.json({
      success: false,
      error: err.message
    })
  }
}