"use client"

import { useEffect, useMemo, useState } from "react"
import { useDynamicContext, useUserWallets } from "@dynamic-labs/sdk-react-core"
import { CheckCircle2, Copy } from "lucide-react"
import {
  DashboardHeroCard,
  DashboardSection,
  ProviderStatusPill,
  dashboardPageTitleClass,
} from "@/components/dashboard/DashboardPrimitives"
import { usePineTreeWalletInfrastructureStatus } from "@/components/providers/PineTreeDynamicProvider"

type WalletGroupId = "solana" | "base" | "bitcoin" | "lightning"

const walletGroups: Array<{
  id: WalletGroupId
  label: string
  description: string
}> = [
  { id: "solana", label: "PineTree Solana Wallet", description: "Embedded SVM wallet address" },
  { id: "base", label: "PineTree Base Wallet", description: "Embedded EVM wallet address for Base" },
  { id: "bitcoin", label: "PineTree Bitcoin Wallet", description: "Embedded Bitcoin wallet address" },
  { id: "lightning", label: "PineTree Lightning Wallet", description: "Embedded Spark wallet address" },
]

function walletGroup(chain: string, key: string, connectorName: string): WalletGroupId | null {
  const identity = `${chain} ${key} ${connectorName}`.toLowerCase()
  if (identity.includes("spark") || identity.includes("lightning")) return "lightning"
  if (chain.toUpperCase() === "SOL" || identity.includes("solana")) return "solana"
  if (chain.toUpperCase() === "EVM" || identity.includes("ethereum")) return "base"
  if (chain.toUpperCase() === "BTC" || identity.includes("bitcoin")) return "bitcoin"
  return null
}

function shortAddress(address: string) {
  if (address.length <= 26) return address
  return `${address.slice(0, 12)}…${address.slice(-10)}`
}

function WalletSetupUnavailable({ kind }: { kind: "missing-env" | "sdk" }) {
  const missingEnvironment = kind === "missing-env"
  return (
    <div className="rounded-2xl border border-amber-200/80 bg-amber-50/70 px-4 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
      <ProviderStatusPill label="Setup unavailable" tone="amber" />
      <p className="mt-3 text-sm font-semibold text-gray-950">
        {missingEnvironment ? "PineTree Wallets environment is not configured." : "PineTree Wallets could not load."}
      </p>
      <p className="mt-1 text-sm leading-5 text-gray-600">
        {missingEnvironment
          ? "Add the public wallet environment ID and redeploy this app."
          : "Refresh the page and try again. Existing PineTree dashboard features are still available."}
      </p>
    </div>
  )
}

function PineTreeWalletSetupRuntime() {
  const { user, sdkHasLoaded, setShowAuthFlow, setShowDynamicUserProfile } = useDynamicContext()
  const wallets = useUserWallets()
  const [loadTimedOut, setLoadTimedOut] = useState(false)
  const [copiedAddress, setCopiedAddress] = useState("")

  useEffect(() => {
    if (sdkHasLoaded) return
    const timer = window.setTimeout(() => setLoadTimedOut(true), 12000)
    return () => window.clearTimeout(timer)
  }, [sdkHasLoaded])

  const groupedWallets = useMemo(() => {
    const groups: Record<WalletGroupId, Array<{ id: string; address: string; detail?: string }>> = {
      solana: [],
      base: [],
      bitcoin: [],
      lightning: [],
    }

    for (const wallet of wallets) {
      const group = walletGroup(wallet.chain, wallet.key, wallet.connector.name)
      if (!group) continue
      groups[group].push({ id: wallet.id, address: wallet.address })

      if (group === "bitcoin") {
        for (const extra of wallet.additionalAddresses || []) {
          if (!extra.address || extra.address === wallet.address) continue
          groups.bitcoin.push({
            id: `${wallet.id}-${extra.type}`,
            address: extra.address,
            detail: String(extra.type).replaceAll("_", " "),
          })
        }
      }
    }
    return groups
  }, [wallets])

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address)
      setCopiedAddress(address)
      window.setTimeout(() => setCopiedAddress(""), 1800)
    } catch {
      setCopiedAddress("")
    }
  }

  if (loadTimedOut && !sdkHasLoaded) return <WalletSetupUnavailable kind="sdk" />

  if (!sdkHasLoaded) {
    return (
      <div className="rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-5 text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-[#0052FF] border-t-transparent" />
        <p className="mt-2 text-sm font-semibold text-blue-700">Loading PineTree Wallets…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <ProviderStatusPill label="Not connected" tone="slate" />
          <p className="mt-3 text-sm font-semibold text-gray-950">Connect to create and view PineTree Wallets.</p>
          <p className="mt-1 text-sm leading-5 text-gray-600">
            Authenticate securely, then PineTree will display the embedded wallet addresses available to this account.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowAuthFlow(true)}
            className="h-10 rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            Create PineTree Wallets
          </button>
          <button
            type="button"
            onClick={() => setShowAuthFlow(true)}
            className="h-10 rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700"
          >
            Connect Wallet
          </button>
        </div>
      </div>
    )
  }

  const walletCount = Object.values(groupedWallets).reduce((count, group) => count + group.length, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <ProviderStatusPill label="Connected" tone="green" />
          <p className="mt-2 text-sm text-gray-600">
            {walletCount > 0
              ? `${walletCount} PineTree wallet ${walletCount === 1 ? "address" : "addresses"} available.`
              : "Wallets not created yet."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowDynamicUserProfile(true)}
          className="h-9 rounded-lg border border-gray-200 bg-white px-3.5 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700"
        >
          {walletCount > 0 ? "Manage PineTree Wallets" : "Create PineTree Wallets"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {walletGroups.map((group) => {
          const addresses = groupedWallets[group.id]
          return (
            <article key={group.id} className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-gray-950">{group.label}</h2>
                  <p className="mt-1 text-xs text-gray-500">{group.description}</p>
                </div>
                <ProviderStatusPill label={addresses.length ? "Ready" : "Not created"} tone={addresses.length ? "green" : "slate"} />
              </div>

              <div className="mt-3 space-y-2">
                {addresses.length ? addresses.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50/80 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      {entry.detail ? <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{entry.detail}</p> : null}
                      <p className="truncate font-mono text-xs text-gray-800" title={entry.address}>{shortAddress(entry.address)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyAddress(entry.address)}
                      aria-label={`Copy ${group.label} address`}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition hover:text-blue-700"
                    >
                      {copiedAddress === entry.address ? <CheckCircle2 size={15} /> : <Copy size={15} />}
                    </button>
                  </div>
                )) : (
                  <p className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-3 text-xs text-gray-500">
                    No wallet address available yet.
                  </p>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

export default function PineTreeWalletSetupPage() {
  const infrastructure = usePineTreeWalletInfrastructureStatus()

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">PineTree Wallets</p>
        <h1 className={`${dashboardPageTitleClass} mt-1`}>PineTree Wallet Setup</h1>
      </div>

      <DashboardHeroCard
        eyebrow="PineTree Wallets"
        title="Embedded wallet proof of setup"
        detail="Create or connect PineTree Wallets and verify the wallet addresses assigned to this account. Payments are not enabled through these wallets yet."
      />

      <DashboardSection title="PineTree Wallets" titleTone="blue">
        {!infrastructure.configured ? (
          <WalletSetupUnavailable kind="missing-env" />
        ) : infrastructure.sdkUnavailable ? (
          <WalletSetupUnavailable kind="sdk" />
        ) : (
          <PineTreeWalletSetupRuntime />
        )}
      </DashboardSection>
    </div>
  )
}
