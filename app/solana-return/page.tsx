"use client"

import { useEffect } from "react"

export default function SolanaReturnPage() {

  useEffect(() => {
    async function handleConnect() {
      try {
        const params = new URLSearchParams(window.location.search)

        const session_id = params.get("session_id")
        const wallet_type = params.get("wallet_type")
        const return_to = params.get("return_to")

        if (!session_id) {
          console.error("❌ Missing session_id")
          return
        }

        const provider = window.solana

        if (!provider) {
          alert("No Solana wallet found (Phantom / Solflare)")
          return
        }

        /* =========================
           CONNECT WALLET
        ========================= */

        const resp = await provider.connect()
        const wallet_address = resp.publicKey.toString()

        console.log("✅ Wallet connected:", wallet_address)

        /* =========================
           UPDATE SESSION (FIXED)
        ========================= */

        const origin = window.location.origin

        const res = await fetch(`${origin}/api/wallet-connect-session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            session_id,
            provider: "solana",
            wallet_type: wallet_type || "PHANTOM",
            wallet_address,
            status: "connected",
          }),
        })

        if (!res.ok) {
          const text = await res.text().catch(() => "")
          console.error("❌ Session update failed:", text)
          throw new Error("Failed to update session")
        }

        console.log("✅ Session updated successfully")

        /* =========================
           REDIRECT BACK
        ========================= */

        window.location.href = return_to || "/dashboard/providers"

      } catch (err) {
        console.error("❌ Solana connect error:", err)
        alert("Wallet connection failed")
      }
    }

    handleConnect()
  }, [])

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "sans-serif",
        background: "black",
        color: "white"
      }}
    >
      <p>Connecting to wallet...</p>
    </div>
  )
}