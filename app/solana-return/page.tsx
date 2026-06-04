"use client"

import { useEffect, useState } from "react"

type SetupState = "connecting" | "success" | "failed"

export default function SolanaReturnPage() {
  const [setupState, setSetupState] = useState<SetupState>("connecting")
  const [message, setMessage] = useState("Connecting wallet...")

  useEffect(() => {
    async function handleConnect() {
      try {
        const params = new URLSearchParams(window.location.search)
        const sessionId = params.get("session_id")
        const walletType = params.get("wallet_type")

        if (!sessionId) {
          setMessage("Wallet setup link is missing a session.")
          setSetupState("failed")
          return
        }

        const provider = window.solana

        if (!provider) {
          setMessage("No Solana wallet found. Open this link from Phantom or Solflare.")
          setSetupState("failed")
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
          setMessage("Failed to update wallet session.")
          setSetupState("failed")
          return
        }

        setMessage("Return to PineTree on your desktop to review and save this wallet.")
        setSetupState("success")
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Wallet connection failed.")
        setSetupState("failed")
      }
    }

    handleConnect()
  }, [])

  return (
    <WalletSetupStatus
      state={setupState}
      message={message}
    />
  )
}

function WalletSetupStatus(props: { state: SetupState; message: string }) {
  const title =
    props.state === "success"
      ? "Wallet connected successfully"
      : props.state === "failed"
        ? "Wallet connection failed"
        : "Connecting wallet..."

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "sans-serif",
        background: "black",
        color: "white",
        padding: 24,
      }}
    >
      <main style={{ maxWidth: 380, textAlign: "center" }}>
        <h1 style={{ margin: "0 0 12px", fontSize: 24, lineHeight: 1.2 }}>{title}</h1>
        <p style={{ margin: "0 0 10px", lineHeight: 1.5 }}>{props.message}</p>
        {props.state === "success" && (
          <p style={{ margin: 0, color: "#cbd5e1", lineHeight: 1.5 }}>
            Do not close the desktop setup window until the address appears.
          </p>
        )}
        {props.state === "failed" && (
          <p style={{ margin: 0, color: "#cbd5e1", lineHeight: 1.5 }}>
            Return to PineTree and try again.
          </p>
        )}
      </main>
    </div>
  )
}
