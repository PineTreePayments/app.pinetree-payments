"use client"

/**
 * /base-wallet-setup
 *
 * Mobile callback page for EVM (Base / MetaMask / Trust Wallet) provider setup.
 * Opened inside a wallet's in-app browser via a deep link from the Providers page.
 *
 * Flow:
 *   1. Merchant taps "Open Mobile Wallet" on the Providers page.
 *   2. providers/page.tsx creates a wallet-connect session (status: "pending") and
 *      opens the wallet app via a deep link: metamask://dapp?url=<this_page_url>
 *   3. The wallet's in-app browser loads this page.
 *   4. window.ethereum is injected by the wallet; eth_requestAccounts is called.
 *   5. The resolved address is POSTed back to /api/wallet-connect-session.
 *   6. This page redirects to return_to (the Providers dashboard).
 *   7. The Providers page polling loop picks up status: "connected" + wallet_address
 *      and auto-populates the address field.
 *
 * This page is ONLY for provider wallet address setup.
 * It has no connection to Base V7 payment execution, the relayer, WalletConnect
 * payment sessions, or the customer checkout flow.
 */

import { useEffect } from "react"

// window.ethereum is declared in types/global.d.ts as Eip1193Provider.
// No local declaration needed.

export default function BaseWalletSetupPage() {
  useEffect(() => {
    async function handleConnect() {
      try {
        const params = new URLSearchParams(window.location.search)
        const session_id = params.get("session_id")
        const wallet_type = params.get("wallet_type")
        const return_to = params.get("return_to")

        if (!session_id) {
          console.error("[base-wallet-setup] Missing session_id")
          return
        }

        if (!window.ethereum) {
          alert(
            "No EVM wallet found. Please open this link from within your MetaMask, " +
            "Trust Wallet, or Coinbase Wallet browser."
          )
          return
        }

        // Request accounts — this triggers the wallet's connect/approve prompt.
        const accountsResponse = await window.ethereum.request({
          method: "eth_requestAccounts",
        })
        const accounts = Array.isArray(accountsResponse)
          ? accountsResponse.map((v) => String(v))
          : []

        if (!accounts[0]) {
          alert("No wallet account returned. Please try again.")
          return
        }

        const wallet_address = accounts[0]

        // POST the address back to the session so the Providers page can pick it up.
        const res = await fetch(`${window.location.origin}/api/wallet-connect-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id,
            provider: "base",
            wallet_type: wallet_type || "BASEAPP",
            wallet_address,
            status: "connected",
          }),
        })

        if (!res.ok) {
          const text = await res.text().catch(() => "")
          console.error("[base-wallet-setup] Session update failed:", text)
          alert("Failed to update wallet session. Please return to the app and try again.")
          return
        }

        // Redirect back to the Providers page (or wherever return_to points).
        window.location.href = return_to || "/dashboard/providers"
      } catch (err) {
        console.error("[base-wallet-setup] EVM wallet setup error:", err)
        alert("Wallet connection failed. Please try again.")
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
      <p>Connecting wallet...</p>
    </div>
  )
}
