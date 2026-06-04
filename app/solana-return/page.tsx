"use client"

import { useEffect } from "react"

export default function SolanaReturnPage() {
  useEffect(() => {
    async function handleConnect() {
      try {
        const params = new URLSearchParams(window.location.search)
        const sessionId = params.get("session_id")
        const walletType = params.get("wallet_type")
        const returnTo = params.get("return_to")

        if (!sessionId) {
          alert("Wallet setup link is missing a session. Please return to PineTree and generate a new setup QR.")
          return
        }

        const provider = window.solana

        if (!provider) {
          alert("No Solana wallet found. Please open this link from Phantom or Solflare.")
          return
        }

        const response = await provider.connect()
        const walletAddress = response.publicKey.toString()

        const res = await fetch(`${window.location.origin}/api/wallet-connect-session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            session_id: sessionId,
            provider: "solana",
            wallet_type: walletType || "PHANTOM",
            wallet_address: walletAddress,
            status: "connected",
          }),
        })

        if (!res.ok) {
          alert("Failed to update wallet session. Please return to PineTree and try again.")
          return
        }

        window.location.href = returnTo || "/dashboard/providers"
      } catch (err) {
        alert(err instanceof Error ? err.message : "Wallet connection failed. Please try again.")
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
        color: "white",
      }}
    >
      <p>Connecting to wallet...</p>
    </div>
  )
}
