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
          console.error("Missing session_id")
          return
        }

        const provider = (window as any).solana

        if (!provider) {
          alert("No Solana wallet found (Phantom / Solflare)")
          return
        }

        // 🔥 FORCE WALLET CONNECTION
        const resp = await provider.connect()

        const wallet_address = resp.publicKey.toString()

        console.log("Wallet connected:", wallet_address)

        // ✅ SEND BACK TO YOUR SESSION TABLE
        const res = await fetch("/api/wallet-connect-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            session_id,
            provider: "solana",
            wallet_type,
            wallet_address,
            status: "connected",
          }),
        })

        if (!res.ok) {
          throw new Error("Failed to update session")
        }

        // ✅ GO BACK TO DASHBOARD
        window.location.href = return_to || "/dashboard/providers"

      } catch (err) {
        console.error("Solana connect error:", err)
        alert("Wallet connection failed")
      }
    }

    handleConnect()
  }, [])

  return (
    <div style={{
      height: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "sans-serif"
    }}>
      <p>Connecting to wallet...</p>
    </div>
  )
}