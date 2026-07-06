"use client"

import { Component, createContext, useContext, useEffect, type ErrorInfo, type ReactNode } from "react"
import { DynamicContextProvider, type WalletOption } from "@dynamic-labs/sdk-react-core"
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum"
import { SolanaWalletConnectors } from "@dynamic-labs/solana"
import { BitcoinWalletConnectors } from "@dynamic-labs/bitcoin"

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
  "turnkeyhd",
  "zerodev",
  "magicemailotp",
  "magiclink",
  "magicsocial",
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
  const kept = options.flatMap((option) => {
    const groupedWallets: WalletOption[] | undefined = option.groupedWallets
      ? filterPineTreeMerchantWalletOptions(option.groupedWallets)
      : undefined

    if (groupedWallets?.length) return [{ ...option, groupedWallets }]
    if (isEmbeddedMerchantWalletOption(option)) return [option]
    if (isBlockedMerchantExternalWalletOption(option)) return []
    return []
  })

  if (process.env.NODE_ENV !== "production") {
    console.debug("[pinetree-wallets] dynamic_wallet_filter", {
      inputCount: options.length,
      keptCount: kept.length,
      removedCount: Math.max(options.length - kept.length, 0),
      inputConnectors: options.map((option) => ({
        key: option.key,
        name: option.name,
        connectorKey: option.walletConnector.key,
        connectorName: option.walletConnector.name,
        isEmbeddedWallet: Boolean(option.walletConnector.isEmbeddedWallet),
        isWalletConnect: Boolean(option.walletConnector.isWalletConnect),
      })),
      keptConnectors: kept.map((option) => ({
        key: option.key,
        name: option.name,
        connectorKey: option.walletConnector.key,
        connectorName: option.walletConnector.name,
        isEmbeddedWallet: Boolean(option.walletConnector.isEmbeddedWallet),
      })),
    })
  }

  return kept
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
  // Temporary sandbox/dev fallback: Dynamic email OTP remains enabled in the
  // Dynamic dashboard until PineTree-controlled BYOA/external-JWT auth is live.
  const dynamicEmailFallbackEnabled =
    process.env.NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK !== "false"

  useEffect(() => {
    console.info("[pinetree-wallets] dynamic_environment_config", {
      NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID: environmentId ? "present" : "missing",
      pineTreeDynamicEmailFallbackEnabled: dynamicEmailFallbackEnabled,
    })
  }, [dynamicEmailFallbackEnabled, environmentId])

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
          ],
          detectNewWalletsForLinking: false,
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
