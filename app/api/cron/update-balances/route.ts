import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabaseClient"

export async function GET() {
  try {

    const { data: wallets, error } = await supabase
      .from("merchant_wallets")
      .select("*")

    if (error) throw error

    console.log("WALLETS FOUND:", wallets?.length)

    if (!wallets || wallets.length === 0) {
      return NextResponse.json({
        success: false,
        message: "No wallets found"
      })
    }

    const results = []

    for (const wallet of wallets) {

      const walletAddress = wallet.wallet_address
      const network = wallet.network

      if (!walletAddress || !network) continue

      let balance = 0

      try {

        /* SOLANA */
        if (network === "solana") {
          const response = await fetch("https://api.mainnet-beta.solana.com", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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

        /* ETH / BASE */
        if (network === "base" || network === "ethereum") {
          const response = await fetch("https://eth.llamarpc.com", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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

        const { error: upsertError } = await supabase
          .from("wallet_balances")
          .upsert({
            merchant_id: wallet.merchant_id,
            asset: network.toUpperCase(),
            balance,
            last_updated: new Date().toISOString(),
          })

        results.push({
          wallet: walletAddress,
          network,
          balance,
          error: upsertError?.message || null
        })

      } catch (err: any) {
        results.push({
          wallet: walletAddress,
          network,
          error: err.message
        })
      }
    }

    return NextResponse.json({
      success: true,
      results
    })

  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message
    })
  }
}