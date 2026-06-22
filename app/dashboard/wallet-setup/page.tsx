"use client"

import { useEffect, useMemo, useState } from "react"
import { useDynamicContext, useUserWallets } from "@dynamic-labs/sdk-react-core"
import { CheckCircle2, Copy } from "lucide-react"
import {
  DashboardSection,
  ProviderStatusPill,
  dashboardPageTitleClass,
} from "@/components/dashboard/DashboardPrimitives"
import { usePineTreeWalletInfrastructureStatus } from "@/components/providers/PineTreeDynamicProvider"

type NetworkId = "base" | "solana" | "bitcoin" | "lightning"
type AddressEntry = { id: string; address: string; detail?: string }

const networks: Array<{ id: NetworkId; label: string }> = [
  { id: "base", label: "Base address" },
  { id: "solana", label: "Solana address" },
  { id: "bitcoin", label: "Bitcoin address" },
  { id: "lightning", label: "Lightning/Spark address" },
]

function networkForWallet(chain: string, key: string, connectorName: string): NetworkId | null {
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

function WalletProfileShell({
  status,
  tone,
  message,
}: {
  status: "Needs attention" | "Loading"
  tone: "amber" | "blue"
  message: string
}) {
  return (
    <article className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-950">PineTree Wallet</h2>
          <p className="mt-1 text-sm leading-5 text-gray-600">{message}</p>
        </div>
        <ProviderStatusPill label={status} tone={tone} />
      </div>
    </article>
  )
}

function WalletSetupUnavailable({ kind }: { kind: "missing-env" | "sdk" }) {
  return (
    <WalletProfileShell
      status="Needs attention"
      tone="amber"
      message={kind === "missing-env"
        ? "PineTree Wallet setup is not configured for this deployment."
        : "PineTree Wallet setup could not load. Refresh the page and try again."}
    />
  )
}

function PineTreeWalletRuntime() {
  const { user, sdkHasLoaded, setShowAuthFlow, setShowDynamicUserProfile } = useDynamicContext()
  const wallets = useUserWallets()
  const [loadTimedOut, setLoadTimedOut] = useState(false)
  const [copiedAddress, setCopiedAddress] = useState("")

  useEffect(() => {
    if (sdkHasLoaded) return
    const timer = window.setTimeout(() => setLoadTimedOut(true), 12000)
    return () => window.clearTimeout(timer)
  }, [sdkHasLoaded])

  const networkAddresses = useMemo(() => {
    const groups: Record<NetworkId, AddressEntry[]> = {
      base: [],
      solana: [],
      bitcoin: [],
      lightning: [],
    }

    for (const wallet of wallets) {
      const network = networkForWallet(wallet.chain, wallet.key, wallet.connector.name)
      if (!network) continue
      groups[network].push({ id: wallet.id, address: wallet.address })

      if (network === "bitcoin") {
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
      <WalletProfileShell
        status="Loading"
        tone="blue"
        message="Loading this merchant’s PineTree Wallet profile and network addresses."
      />
    )
  }

  const hasAddresses = Object.values(networkAddresses).some((entries) => entries.length > 0)
  const walletStatus = hasAddresses ? "Ready" : user ? "Needs attention" : "Not created"
  const statusTone = hasAddresses ? "green" : user ? "amber" : "slate"

  function openPineTreeWallet() {
    if (hasAddresses && user) {
      setShowDynamicUserProfile(true)
      return
    }
    setShowAuthFlow(true)
  }

  return (
    <article className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-gray-950">PineTree Wallet</h2>
            <ProviderStatusPill
              label={walletStatus}
              tone={statusTone as "green" | "amber" | "slate"}
            />
          </div>
          <p className="mt-2 text-sm leading-5 text-gray-600">
            One business wallet profile for this merchant, with separate addresses for Base, Solana, Bitcoin, and Lightning/Spark.
          </p>
        </div>
        <button
          type="button"
          onClick={openPineTreeWallet}
          className="h-10 rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          {hasAddresses ? "Open PineTree Wallet" : "Create PineTree Wallet"}
        </button>
      </div>

      {hasAddresses ? (
        <section className="mt-5 border-t border-gray-100 pt-4">
          <h3 className="text-sm font-semibold text-gray-950">Network addresses</h3>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            Each network uses its own address format, so PineTree Wallet stores separate addresses under one merchant wallet profile.
          </p>

          <div className="mt-3 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200/80 bg-gray-50/50">
            {networks.map((network) => {
              const addresses = networkAddresses[network.id]
              return (
                <div key={network.id} className="grid gap-2 px-3 py-3 sm:grid-cols-[150px_1fr] sm:items-start">
                  <p className="text-xs font-semibold text-gray-700">{network.label}</p>
                  <div className="min-w-0 space-y-2">
                    {addresses.length ? addresses.map((entry) => (
                      <div key={entry.id} className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0 flex-1">
                          {entry.detail ? (
                            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{entry.detail}</p>
                          ) : null}
                          <p className="truncate font-mono text-xs text-gray-800" title={entry.address}>
                            {shortAddress(entry.address)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void copyAddress(entry.address)}
                          aria-label={`Copy ${network.label}`}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition hover:text-blue-700"
                        >
                          {copiedAddress === entry.address ? <CheckCircle2 size={15} /> : <Copy size={15} />}
                        </button>
                      </div>
                    )) : (
                      <p className="text-xs text-gray-400">Not available yet</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50/70 px-3 py-3 text-xs leading-5 text-gray-500">
          Create PineTree Wallet to generate this merchant’s network addresses.
        </p>
      )}

      <details className="mt-4 border-t border-gray-100 pt-3">
        <summary className="cursor-pointer text-xs font-semibold text-gray-500 transition hover:text-gray-700">
          Advanced wallet options
        </summary>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gray-50/80 px-3 py-3">
          <p className="text-xs leading-5 text-gray-500">
            Connect an existing external wallet for advanced setup or account recovery workflows.
          </p>
          <button
            type="button"
            onClick={() => setShowAuthFlow(true)}
            className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 shadow-sm transition hover:text-blue-700"
          >
            Connect external wallet
          </button>
        </div>
      </details>
    </article>
  )
}

export default function PineTreeWalletPage() {
  const infrastructure = usePineTreeWalletInfrastructureStatus()

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">Merchant wallet</p>
        <h1 className={`${dashboardPageTitleClass} mt-1`}>PineTree Wallet</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
          PineTree Wallet is one business wallet profile for this merchant. It stores separate network addresses for Base, Solana, Bitcoin, and Lightning/Spark in one place.
        </p>
      </div>

      <DashboardSection title="PineTree Wallet" titleTone="blue">
        {!infrastructure.configured ? (
          <WalletSetupUnavailable kind="missing-env" />
        ) : infrastructure.sdkUnavailable ? (
          <WalletSetupUnavailable kind="sdk" />
        ) : (
          <PineTreeWalletRuntime />
        )}
      </DashboardSection>
    </div>
  )
}
