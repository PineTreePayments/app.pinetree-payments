"use client"

import { useEffect, useMemo, useState } from "react"
import { useDynamicContext, useUserWallets } from "@dynamic-labs/sdk-react-core"
import { CheckCircle2, Copy, X } from "lucide-react"
import {
  DashboardSection,
  ProviderStatusPill,
  dashboardPageTitleClass,
} from "@/components/dashboard/DashboardPrimitives"
import { usePineTreeWalletInfrastructureStatus } from "@/components/providers/PineTreeDynamicProvider"

type NetworkId = "base" | "solana" | "bitcoin" | "lightning"
type WalletTab = "overview" | "balances" | "receive" | "withdraw" | "activity"
type AddressEntry = { id: string; address: string; detail?: string }

const walletTabs: Array<{ id: WalletTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "balances", label: "Balances" },
  { id: "receive", label: "Receive" },
  { id: "withdraw", label: "Withdraw" },
  { id: "activity", label: "Activity" },
]

const primaryRails = ["Base", "Solana", "Bitcoin Lightning"] as const

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
    <article className="rounded-2xl border border-gray-200/80 bg-white/90 p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur sm:p-5">
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

function EmptyWalletPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/70 px-4 py-8 text-center">
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <p className="mt-1 text-xs leading-5 text-gray-500">{detail}</p>
    </div>
  )
}

function PineTreeWalletRuntime() {
  const { user, sdkHasLoaded, setShowAuthFlow } = useDynamicContext()
  const wallets = useUserWallets()
  const [loadTimedOut, setLoadTimedOut] = useState(false)
  const [copiedAddress, setCopiedAddress] = useState("")
  const [walletOpen, setWalletOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<WalletTab>("overview")

  useEffect(() => {
    if (sdkHasLoaded) return
    const timer = window.setTimeout(() => setLoadTimedOut(true), 12000)
    return () => window.clearTimeout(timer)
  }, [sdkHasLoaded])

  useEffect(() => {
    if (!walletOpen) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setWalletOpen(false)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [walletOpen])

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
        message="Loading this merchant’s PineTree Wallet profile."
      />
    )
  }

  const hasAddresses = Object.values(networkAddresses).some((entries) => entries.length > 0)
  const walletStatus = hasAddresses ? "Ready" : user ? "Needs attention" : "Not created"
  const statusTone = hasAddresses ? "green" : user ? "amber" : "slate"

  function handlePrimaryAction() {
    if (!hasAddresses) {
      setShowAuthFlow(true)
      return
    }
    setActiveTab("overview")
    setWalletOpen(true)
  }

  function ReceiveRow({ label, entries }: { label: string; entries: AddressEntry[] }) {
    return (
      <div className="rounded-xl border border-gray-200/80 bg-white px-3 py-3 shadow-sm">
        <p className="text-xs font-semibold text-gray-700">{label}</p>
        <div className="mt-2 space-y-2">
          {entries.length ? entries.map((entry) => (
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
                aria-label={`Copy ${label}`}
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
  }

  return (
    <>
      <article className="rounded-2xl border border-gray-200/80 bg-white/90 p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur sm:p-5">
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
              One merchant wallet for receiving funds and managing PineTree’s supported payment rails.
            </p>
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Supported rails">
              {primaryRails.map((rail) => (
                <span key={rail} className="rounded-full border border-blue-100 bg-blue-50/80 px-2.5 py-1 text-xs font-semibold text-blue-700">
                  {rail}
                </span>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={handlePrimaryAction}
            className="h-10 rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            {hasAddresses ? "Open PineTree Wallet" : "Create PineTree Wallet"}
          </button>
        </div>
      </article>

      {walletOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm sm:p-5"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setWalletOpen(false)
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="pinetree-wallet-modal-title"
            className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-[1.35rem] border border-white/70 bg-white/95 shadow-[0_28px_90px_rgba(15,23,42,0.28)] backdrop-blur-xl"
          >
            <header className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-4 sm:px-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="pinetree-wallet-modal-title" className="text-lg font-semibold text-gray-950">PineTree Wallet</h2>
                  <ProviderStatusPill label="Ready" tone="green" />
                </div>
                <p className="mt-1 text-xs text-gray-500">Merchant wallet profile</p>
              </div>
              <button
                type="button"
                onClick={() => setWalletOpen(false)}
                aria-label="Close PineTree Wallet"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 shadow-sm transition hover:text-gray-900"
              >
                <X size={17} />
              </button>
            </header>

            <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-100 px-3 py-2 sm:px-4" aria-label="PineTree Wallet sections">
              {walletTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                    activeTab === tab.id ? "bg-[#0052FF] text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
              {activeTab === "overview" ? (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-950">One merchant wallet profile</p>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      PineTree Wallet keeps each supported rail organized under one business wallet experience.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {["Base", "Solana", "Bitcoin Lightning / Spark"].map((rail) => (
                      <div key={rail} className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-3">
                        <p className="text-xs font-semibold text-blue-800">{rail}</p>
                        <p className="mt-1 text-[11px] text-blue-600">Supported rail</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {activeTab === "balances" ? (
                <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200/80 bg-white">
                  {[
                    ["Base balance", "Not available yet"],
                    ["Solana balance", "Not available yet"],
                    ["Bitcoin Lightning balance", "Not available yet"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-3 px-3 py-3 text-xs">
                      <span className="font-semibold text-gray-700">{label}</span>
                      <span className="text-gray-400">{value}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {activeTab === "receive" ? (
                <div className="space-y-3">
                  <ReceiveRow label="Base address" entries={networkAddresses.base} />
                  <ReceiveRow label="Solana address" entries={networkAddresses.solana} />
                  <ReceiveRow label="Bitcoin Lightning/Spark address" entries={networkAddresses.lightning} />
                  {networkAddresses.bitcoin.length ? (
                    <div className="pt-2">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Secondary</p>
                      <ReceiveRow label="Bitcoin on-chain address" entries={networkAddresses.bitcoin} />
                    </div>
                  ) : null}
                </div>
              ) : null}

              {activeTab === "withdraw" ? (
                <EmptyWalletPanel title="Withdrawals coming soon" detail="Withdrawal controls will be added in a future PineTree Wallet release." />
              ) : null}

              {activeTab === "activity" ? (
                <EmptyWalletPanel title="Wallet activity will appear here." detail="Wallet activity syncing is not enabled yet." />
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
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
          Create and open one merchant wallet for Base, Solana, and Bitcoin Lightning payments.
        </p>
      </div>

      <DashboardSection title="Wallet setup" titleTone="blue">
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
