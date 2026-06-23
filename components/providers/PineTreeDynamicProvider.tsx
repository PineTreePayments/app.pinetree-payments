"use client"

import { Component, createContext, useContext, type ErrorInfo, type ReactNode } from "react"
import { DynamicContextProvider, type WalletOption } from "@dynamic-labs/sdk-react-core"
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum"
import { SolanaWalletConnectors } from "@dynamic-labs/solana"
import { BitcoinWalletConnectors } from "@dynamic-labs/bitcoin"
import { SparkWalletConnectors } from "@dynamic-labs/spark"

type PineTreeWalletInfrastructureStatus = {
  configured: boolean
  sdkUnavailable: boolean
}

const blockedMerchantWalletConnectorTokens = [
  "metamask",
  "coinbase",
  "walletconnect",
  "phantom",
  "solflare",
  "trust",
]

const embeddedMerchantWalletConnectorTokens = [
  "dynamicwaas",
  "turnkey",
]

function normalizeWalletToken(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function isEmbeddedMerchantWalletOption(option: WalletOption) {
  const connector = option.walletConnector
  if (connector.isEmbeddedWallet) return true

  const tokens = [
    normalizeWalletToken(option.key),
    normalizeWalletToken(option.name),
    normalizeWalletToken(connector.key),
    normalizeWalletToken(connector.name),
  ]

  return tokens.some((token) =>
    embeddedMerchantWalletConnectorTokens.some((allowed) => token.includes(allowed))
  )
}

function isBlockedMerchantExternalWalletOption(option: WalletOption) {
  const connector = option.walletConnector
  if (connector.isWalletConnect) return true

  const tokens = [
    normalizeWalletToken(option.key),
    normalizeWalletToken(option.name),
    normalizeWalletToken(connector.key),
    normalizeWalletToken(connector.name),
  ]

  return tokens.some((token) =>
    blockedMerchantWalletConnectorTokens.some((blocked) => token.includes(blocked))
  )
}

export function filterPineTreeMerchantWalletOptions(options: WalletOption[]): WalletOption[] {
  return options.flatMap((option) => {
    const groupedWallets: WalletOption[] | undefined = option.groupedWallets
      ? filterPineTreeMerchantWalletOptions(option.groupedWallets)
      : undefined

    if (groupedWallets?.length) return [{ ...option, groupedWallets }]
    if (isEmbeddedMerchantWalletOption(option)) return [option]
    if (isBlockedMerchantExternalWalletOption(option)) return []
    return []
  })
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
          appName: "PineTree Wallet",
          walletConnectors: [
            EthereumWalletConnectors,
            SolanaWalletConnectors,
            BitcoinWalletConnectors,
            SparkWalletConnectors,
          ],
          walletsFilter: filterPineTreeMerchantWalletOptions,
        }}
      >
        <PineTreeWalletInfrastructureContext.Provider value={{ configured: true, sdkUnavailable: false }}>
          {children}
        </PineTreeWalletInfrastructureContext.Provider>
      </DynamicContextProvider>
    </WalletInfrastructureErrorBoundary>
  )
}
