"use client"

export const dynamic = "force-dynamic"

import { useEffect } from "react"

declare global {
  interface Window {
    ethereum?: any
  }
}

export default function BaseReturnPage() {
  useEffect(() => {
    async function handleConnection() {
      try {
        const params = new URLSearchParams(window.location.search)

        const provider = params.get("provider")
        const walletType = params.get("wallet_type")
        const sessionId = params.get("session_id")
        const returnTo = params.get("return_to")

        if (!sessionId) {
          console.error("❌ Missing session_id")
          return
        }

        if (!window.ethereum) {
          alert("No EVM wallet found (MetaMask / Trust / Coinbase)")
          return
        }

        /* =========================
           CONNECT WALLET
        ========================= */

        const accounts = await window.ethereum.request({
          method: "eth_requestAccounts",
        })

        if (!accounts?.[0]) {
          console.error("❌ No wallet account returned")
          return
        }

        const walletAddress = accounts[0]

        console.log("✅ Base wallet connected:", walletAddress)

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
            session_id: sessionId,
            provider: provider || "base",
            wallet_type: walletType || "BASEAPP",
            wallet_address: walletAddress,
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
            DO NOT REDIRECT
            Session will be picked up by dashboard automatically
         ========================= */

         window.close()
      } catch (err) {
        console.error("❌ BASE RETURN ERROR:", err)
        alert("Wallet connection failed")
      }
    }

    handleConnection()
  }, [])

  return (
    <div
      className="flex items-center justify-center h-screen"
      style={{
        background: "black",
        color: "white",
        fontFamily: "sans-serif"
      }}
    >
      Connecting wallet...
    </div>
  )
}