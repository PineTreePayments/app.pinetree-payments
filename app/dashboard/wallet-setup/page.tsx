"use client"

import { useEffect, useMemo, useState } from "react"
import { useDynamicContext, useUserWallets } from "@dynamic-labs/sdk-react-core"
import { CheckCircle2, Copy, X } from "lucide-react"
import { type NetworkId, networkForWallet, shortAddress } from "@/lib/wallets/sparkDetection"
import {
  DashboardSection,
  ProviderStatusPill,
  dashboardPageTitleClass,
} from "@/components/dashboard/DashboardPrimitives"
import { usePineTreeWalletInfrastructureStatus } from "@/components/providers/PineTreeDynamicProvider"

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

function WalletDiagnosticsPanel({
  wallets,
  networkAddresses,
}: {
  wallets: ReturnType<typeof useUserWallets>
  networkAddresses: Record<NetworkId, AddressEntry[]>
}) {
  const rows = wallets.map((w) => ({
    key: w.key,
    connectorName: w.connector.name,
    connectorKey: String((w.connector as unknown as Record<string, unknown>)["key"] ?? ""),
    chain: w.chain,
    detectedNetwork: networkForWallet(w.chain, w.key, w.connector.name),
    hasAddress: Boolean(w.address),
    addressPrefix: w.address ? `${w.address.slice(0, 6)}…` : "—",
    extraAddressCount: (w.additionalAddresses ?? []).length,
  }))

  useEffect(() => {
    console.debug("[pinetree-wallets] sdk diagnostics", {
      walletCount: wallets.length,
      wallets: rows,
      networkSummary: {
        base: networkAddresses.base.length,
        solana: networkAddresses.solana.length,
        lightning: networkAddresses.lightning.length,
        bitcoin: networkAddresses.bitcoin.length,
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets])

  return (
    <div className="rounded-xl border border-dashed border-yellow-300 bg-yellow-50/60 px-4 py-3 text-[11px] font-mono">
      <p className="mb-2 font-sans text-xs font-semibold text-yellow-700">DEV — wallet SDK diagnostics (hidden in production)</p>
      {rows.length === 0 ? (
        <p className="text-yellow-700">No wallet objects returned by useUserWallets() yet</p>
      ) : (
        <div className="space-y-1 text-yellow-900">
          {rows.map((row, idx) => (
            <div key={idx} className="flex flex-wrap gap-x-3 rounded bg-yellow-100/70 px-2 py-1">
              <span><span className="text-yellow-600">net:</span> {row.detectedNetwork ?? "undetected"}</span>
              <span><span className="text-yellow-600">chain:</span> {row.chain}</span>
              <span><span className="text-yellow-600">connector:</span> {row.connectorName}{row.connectorKey ? ` [${row.connectorKey}]` : ""}</span>
              <span><span className="text-yellow-600">addr:</span> {row.addressPrefix}</span>
              {row.extraAddressCount > 0 ? <span><span className="text-yellow-600">+extra:</span> {row.extraAddressCount}</span> : null}
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-3 text-yellow-700">
        <span>lightning: {networkAddresses.lightning.length}</span>
        <span>base: {networkAddresses.base.length}</span>
        <span>solana: {networkAddresses.solana.length}</span>
        <span>btc: {networkAddresses.bitcoin.length}</span>
      </div>
    </div>
  )
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
    <article className="rounded-2xl border border-gray-200/80 bg-white/90 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.07)] backdrop-blur sm:p-7">
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

  const hasAnyAddress = Object.values(networkAddresses).some((entries) => entries.length > 0)
  const baseReady = networkAddresses.base.length > 0
  const solanaReady = networkAddresses.solana.length > 0
  const lightningReady = networkAddresses.lightning.length > 0
  const allPrimaryRailsReady = baseReady && solanaReady && lightningReady
  const walletStatus = !hasAnyAddress ? "Not created" : allPrimaryRailsReady ? "Ready" : "Needs attention"
  const statusTone = !hasAnyAddress ? "slate" : allPrimaryRailsReady ? "green" : "amber"

  function handlePrimaryAction() {
    if (!hasAnyAddress) {
      setShowAuthFlow(true)
      return
    }
    setActiveTab("overview")
    setWalletOpen(true)
  }

  function ReceiveRow({ label, entries }: { label: string; entries: AddressEntry[] }) {
    const ready = entries.length > 0
    return (
      <div className="rounded-2xl border border-gray-200/80 bg-white px-4 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)] sm:px-5 sm:py-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-gray-800">{label}</p>
          <ProviderStatusPill label={ready ? "Ready" : "Setup pending"} tone={ready ? "green" : "amber"} />
        </div>
        <div className="mt-3 space-y-3">
          {ready ? entries.map((entry) => (
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
            <p className="text-sm text-amber-700">Setup pending</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <article className="min-h-[230px] rounded-[1.35rem] border border-blue-200/70 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.13),transparent_38%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(247,251,255,0.96))] p-6 shadow-[0_20px_55px_rgba(37,99,235,0.12)] backdrop-blur sm:p-8">
        <div className="flex h-full flex-wrap items-start justify-between gap-8">
          <div className="max-w-2xl space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-gray-950">PineTree Wallet</h2>
              <ProviderStatusPill
                label={walletStatus}
                tone={statusTone as "green" | "amber" | "slate"}
              />
            </div>
            <p className="text-sm leading-6 text-gray-600">
              One merchant wallet for receiving funds and managing PineTree’s supported payment rails.
            </p>
            <div className="flex flex-wrap gap-2.5" aria-label="Supported rails">
              {primaryRails.map((rail) => (
                <span key={rail} className="rounded-full border border-blue-100 bg-blue-50/80 px-2.5 py-1 text-xs font-semibold text-blue-700">
                  {rail}
                </span>
              ))}
            </div>
            {!lightningReady && hasAnyAddress ? (
              <p className="text-xs font-semibold text-amber-700">Bitcoin Lightning setup pending</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handlePrimaryAction}
            className="h-10 rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            {hasAnyAddress ? "Open PineTree Wallet" : "Create PineTree Wallet"}
          </button>
        </div>
      </article>

      {process.env.NODE_ENV !== "production" ? (
        <WalletDiagnosticsPanel wallets={wallets} networkAddresses={networkAddresses} />
      ) : null}

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
            className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-[1.5rem] border border-white/70 bg-white/95 shadow-[0_32px_100px_rgba(15,23,42,0.30)] backdrop-blur-xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-5 sm:px-7 sm:py-6">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="pinetree-wallet-modal-title" className="text-lg font-semibold text-gray-950">PineTree Wallet</h2>
                  <ProviderStatusPill label={walletStatus} tone={statusTone as "green" | "amber" | "slate"} />
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

            <nav className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-gray-100 px-4 py-3 sm:px-6" aria-label="PineTree Wallet sections">
              {walletTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`shrink-0 rounded-xl px-4 py-2.5 text-xs font-semibold transition ${
                    activeTab === tab.id ? "bg-[#0052FF] text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7 sm:py-7">
              {activeTab === "overview" ? (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-950">One merchant wallet profile</p>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      PineTree Wallet keeps each supported rail organized under one business wallet experience.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      { label: "Base", ready: baseReady },
                      { label: "Solana", ready: solanaReady },
                      { label: "Bitcoin Lightning / Spark", ready: lightningReady },
                    ].map((rail) => (
                      <div key={rail.label} className="rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-4 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-blue-900">{rail.label}</p>
                          <ProviderStatusPill label={rail.ready ? "Ready" : "Setup pending"} tone={rail.ready ? "green" : "amber"} />
                        </div>
                        <p className="mt-2 text-xs text-blue-700">
                          {rail.ready
                            ? "Address available"
                            : rail.label.startsWith("Bitcoin")
                              ? "Bitcoin Lightning setup pending"
                              : "Address setup pending"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {activeTab === "balances" ? (
                <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-sm">
                  {[
                    ["Base balance", "Not available yet"],
                    ["Solana balance", "Not available yet"],
                    ["Bitcoin Lightning balance", "Not available yet"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-4 px-4 py-5 text-sm sm:px-5">
                      <span className="font-semibold text-gray-800">{label}</span>
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
                <div className="space-y-5">
                  <div>
                    <p className="text-sm font-semibold text-gray-950">Prepare a withdrawal</p>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      Withdrawals are not enabled yet. This screen is a safe preview of the merchant withdrawal flow.
                    </p>
                  </div>

                  <div className="grid gap-4 rounded-2xl border border-gray-200/80 bg-gray-50/70 p-4 shadow-inner shadow-white sm:p-5">
                    <label className="block">
                      <span className="text-xs font-semibold text-gray-700">Select rail</span>
                      <select
                        defaultValue="base"
                        aria-label="Select withdrawal rail"
                        className="mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                      >
                        <option value="base">Base</option>
                        <option value="solana">Solana</option>
                        <option value="bitcoin_lightning">Bitcoin Lightning</option>
                      </select>
                    </label>

                    <label className="block">
                      <span className="text-xs font-semibold text-gray-700">Destination address</span>
                      <input
                        type="text"
                        inputMode="text"
                        placeholder="Enter destination address"
                        aria-label="Destination address"
                        className="mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                      />
                    </label>

                    <label className="block">
                      <span className="text-xs font-semibold text-gray-700">Amount</span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        placeholder="0.00"
                        aria-label="Withdrawal amount"
                        className="mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                      />
                    </label>

                    <button
                      type="button"
                      disabled
                      className="h-11 cursor-not-allowed rounded-xl bg-gray-200 px-4 text-sm font-semibold text-gray-500"
                    >
                      Review withdrawal — coming soon
                    </button>
                  </div>
                </div>
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
