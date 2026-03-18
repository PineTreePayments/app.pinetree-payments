import { NextResponse } from "next/server"

export async function POST(req: Request) {
  try {
    const { address, network } = await req.json()

    if (!address || !network) {
      return NextResponse.json({ balance: 0 })
    }

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
          params: [address],
        }),
      })

      const data = await response.json()

      const lamports = data?.result?.value ?? 0
      const sol = lamports / 1_000_000_000

      return NextResponse.json({ balance: sol })
    }

    /* =========================
       ETH / BASE (EVM)
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
          params: [address, "latest"],
        }),
      })

      const data = await response.json()

      const hex = data?.result ?? "0x0"

      let balance = 0

      try {
        const wei = BigInt(hex)
        balance = Number(wei) / 1e18
      } catch {
        balance = 0
      }

      return NextResponse.json({ balance })
    }

    return NextResponse.json({ balance: 0 })

  } catch (err) {
    console.error("wallet-balance route error:", err)
    return NextResponse.json({ balance: 0 })
  }
}