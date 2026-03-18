"use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"

export default function SolanaReturnPage() {
  const router = useRouter()
  const params = useSearchParams()

  useEffect(() => {
    try {
      /**
       * =========================
       * 1. GET RETURN DATA
       * =========================
       */

      const publicKey =
        params.get("public_key") ||
        params.get("wallet") ||
        params.get("address")

      const walletType =
        params.get("wallet_type") ||
        params.get("provider") ||
        null

      /**
       * =========================
       * 2. VALIDATE
       * =========================
       */

      if (!publicKey) {
        console.warn("No wallet returned from Solana deep link")

        // still redirect cleanly
        router.replace("/dashboard/providers")
        return
      }

      /**
       * =========================
       * 3. STORE FOR DESKTOP PAGE
       * =========================
       */

      // store wallet address
      localStorage.setItem("solana_wallet", publicKey)

      // store wallet type if available
      if (walletType) {
        localStorage.setItem("solana_wallet_type", walletType)
      }

      /**
       * =========================
       * 4. OPTIONAL: SESSION FLAG
       * =========================
       */

      sessionStorage.setItem("solana_connected", "true")

      /**
       * =========================
       * 5. REDIRECT BACK
       * =========================
       */

      setTimeout(() => {
        router.replace("/dashboard/providers")
      }, 300)

    } catch (err) {
      console.error("Solana return handler error:", err)

      router.replace("/dashboard/providers")
    }
  }, [params, router])

  /**
   * =========================
   * UI (quick loading screen)
   * =========================
   */

  return (
    <div className="h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <p className="text-black text-sm">Connecting wallet...</p>
      </div>
    </div>
  )
}