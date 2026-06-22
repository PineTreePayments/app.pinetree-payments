"use client"

import { Component, createContext, useContext, type ErrorInfo, type ReactNode } from "react"
import { DynamicContextProvider } from "@dynamic-labs/sdk-react-core"
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum"
import { SolanaWalletConnectors } from "@dynamic-labs/solana"
import { BitcoinWalletConnectors } from "@dynamic-labs/bitcoin"
import { SparkWalletConnectors } from "@dynamic-labs/spark"

type PineTreeWalletInfrastructureStatus = {
  configured: boolean
  sdkUnavailable: boolean
}

const PineTreeWalletInfrastructureContext = createContext<PineTreeWalletInfrastructureStatus>({
  configured: false,
  sdkUnavailable: false,
})

export function usePineTreeWalletInfrastructureStatus() {
  return useContext(PineTreeWalletInfrastructureContext)
}

class WalletInfrastructureErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[pinetree-wallets] wallet SDK unavailable", {
      message: error.message,
      componentStack: info.componentStack || undefined,
    })
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export default function PineTreeDynamicProvider({ children }: { children: ReactNode }) {
  const environmentId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID?.trim()

  if (!environmentId) {
    return (
      <PineTreeWalletInfrastructureContext.Provider value={{ configured: false, sdkUnavailable: false }}>
        {children}
      </PineTreeWalletInfrastructureContext.Provider>
    )
  }

  const fallback = (
    <PineTreeWalletInfrastructureContext.Provider value={{ configured: true, sdkUnavailable: true }}>
      {children}
    </PineTreeWalletInfrastructureContext.Provider>
  )

  return (
    <WalletInfrastructureErrorBoundary fallback={fallback}>
      <DynamicContextProvider
        settings={{
          environmentId,
          appName: "PineTree Wallets",
          walletConnectors: [
            EthereumWalletConnectors,
            SolanaWalletConnectors,
            BitcoinWalletConnectors,
            SparkWalletConnectors,
          ],
        }}
      >
        <PineTreeWalletInfrastructureContext.Provider value={{ configured: true, sdkUnavailable: false }}>
          {children}
        </PineTreeWalletInfrastructureContext.Provider>
      </DynamicContextProvider>
    </WalletInfrastructureErrorBoundary>
  )
}
