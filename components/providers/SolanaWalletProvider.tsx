"use client"

import { useMemo } from "react"
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react"

// Public Solana RPC for client-side connections
// Server-side uses SOLANA_RPC_URL (Helius, not exposed to client)
const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com"

export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  // Empty adapter list — Wallet Standard wallets (Phantom, Solflare, Backpack,
  // and any other compliant wallet) are auto-detected from the browser environment.
  // No explicit adapter imports needed and avoids the native Ledger dep (usb/hid).
  const wallets = useMemo(() => [], [])

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  )
}
