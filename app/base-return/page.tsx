"use client"

export const dynamic = "force-dynamic"
export const fetchCache = "force-no-store"

import { useEffect } from "react"
import { useSearchParams } from "next/navigation"

declare global {
  interface Window {
    ethereum?: any
  }
}

export default function BaseReturnPage() {
  const params = useSearchParams()

  useEffect(() => {
    async function handleConnection() {
      try {
        const provider = params.get("provider")
        const walletType = params.get("wallet_type")
        const sessionId = params.get("session_id")
        const returnTo = params.get("return_to")

        console.log("BASE RETURN PARAMS:", {
          provider,
          walletType,
          sessionId,
          returnTo,
        })

        if (!window.ethereum) {
          alert("No EVM wallet found (MetaMask / Trust / Coinbase)")
          return
        }

        // Request wallet connection
        const accounts = await window.ethereum.request({
          method: "eth_requestAccounts",
        })

        if (!accounts || !accounts[0]) {
          console.error("No accounts returned")
          return
        }

        const walletAddress = accounts[0]

        console.log("CONNECTED WALLET:", walletAddress)

        // Update session in DB
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

        // Redirect back to providers page
        if (returnTo) {
          window.location.href = returnTo
        } else {
          window.location.href = "/dashboard/providers"
        }
      } catch (err) {
        console.error("BASE RETURN ERROR:", err)
      }
    }

    handleConnection()
  }, [params])

  return (
    <div className="flex items-center justify-center h-screen text-black">
      Connecting to wallet...
    </div>
  )
}