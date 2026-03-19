import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabaseClient"

export async function GET() {
  try {

    const { data: wallets, error } = await supabase
      .from("merchant_wallets")
      .select("*")

    if (error) throw error

    for (const wallet of wallets || []) {

      const walletAddress = wallet.wallet_address
      const network = wallet.network

      if (!walletAddress || !network) continue

      try {

        let balance = 0

        /* =========================
           SOLANA
        ========================= */

        if (network === "solana") {

          const response = await fetch("https://api.mainnet-beta.solana.com", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "getBalance",
              params: [walletAddress],
            }),
          })

          const data = await response.json()

          const lamports = data?.result?.value ?? 0
          balance = lamports / 1_000_000_000
        }

        /* =========================
           ETH / BASE
        ========================= */

        if (network === "base" || network === "ethereum") {

          const response = await fetch("https://eth.llamarpc.com", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "eth_getBalance",
              params: [walletAddress, "latest"],
            }),
          })

          const data = await response.json()
          const hex = data?.result ?? "0x0"

          try {
            const wei = BigInt(hex)
            balance = Number(wei) / 1e18
          } catch {
            balance = 0
          }
        }

        /* =========================
           STORE BALANCE
        ========================= */

        await supabase
          .from("wallet_balances")
          .upsert({
            merchant_id: wallet.merchant_id,
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
    console.error("Cron route error:", err)
    return NextResponse.json({ success: false })
  }
}