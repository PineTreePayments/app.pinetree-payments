"use client"

export const dynamic = "force-dynamic"

import { useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"

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

        if (!window.ethereum) {
          alert("No EVM wallet found (MetaMask / Trust / Coinbase)")
          return
        }

        const accounts = await window.ethereum.request({
          method: "eth_requestAccounts",
        })

        if (!accounts?.[0]) return

        const walletAddress = accounts[0]

        /* =========================
           GET CURRENT USER
        ========================= */

        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
          console.error("No user session found")
          return
        }

        /* =========================
           EXISTING SESSION SAVE
        ========================= */

        await fetch("/api/wallet-connect-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            session_id: sessionId,
            provider,
            wallet_type: walletType,
            wallet_address: walletAddress,
            status: "connected",
          }),
        })

        /* =========================
           🔥 INSERT WALLET (FIX)
        ========================= */

        const { error } = await supabase
          .from("merchant_wallets")
          .insert({
            merchant_id: user.id,
            wallet_address: walletAddress,
            network: "base",
            provider: provider || walletType || "base"
          })

        if (error) {
          console.error("wallet insert error:", error)
        }

        /* =========================
           REDIRECT
        ========================= */

        window.location.href = returnTo || "/dashboard/providers"

      } catch (err) {
        console.error("BASE RETURN ERROR:", err)
      }
    }

    handleConnection()
  }, [])

  return (
    <div className="flex items-center justify-center h-screen text-black">
      Connecting wallet...
    </div>
  )
}