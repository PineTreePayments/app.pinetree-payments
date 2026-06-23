"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useDynamicContext, useUserWallets } from "@dynamic-labs/sdk-react-core"
import { AlertTriangle, CheckCircle2, Copy, RefreshCw, X, Zap } from "lucide-react"
import { supabase } from "@/lib/supabaseClient"
import {
  extractDynamicWalletAddresses,
  type DynamicAddressMetadata,
  type DynamicWalletAddressSource,
  type NetworkId,
  networkForWallet,
  shortAddress,
} from "@/lib/wallets/sparkDetection"
import {
  DashboardSection,
  ProviderStatusPill,
  dashboardPageTitleClass,
} from "@/components/dashboard/DashboardPrimitives"
import { usePineTreeWalletInfrastructureStatus } from "@/components/providers/PineTreeDynamicProvider"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WalletTab = "overview" | "balances" | "receive" | "withdraw" | "activity"
type AddressEntry = { id: string; address: string; detail?: string }

type PineTreeWalletProfile = {
  id: string
  dynamic_user_id: string | null
  base_address: string | null
  solana_address: string | null
  bitcoin_lightning_address: string | null
  bitcoin_onchain_address: string | null
  bitcoin_lightning_status: "not_configured" | "pending" | "ready" | "needs_attention"
  bitcoin_lightning_provider: string | null
  bitcoin_lightning_account_id: string | null
  status: "not_created" | "needs_attention" | "ready"
}

type MerchantLightningProfile = {
  id: string
  merchant_id: string
  provider: "speed"
  status: "not_configured" | "pending" | "ready" | "needs_attention"
  setup_source: "pinetree_managed"
}

type ProfileState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "loaded"; profile: PineTreeWalletProfile }
  | { kind: "error" }

type LightningProfileState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "loaded"; profile: MerchantLightningProfile }
  | { kind: "error" }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const walletTabs: Array<{ id: WalletTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "balances", label: "Balances" },
  { id: "receive", label: "Receive" },
  { id: "withdraw", label: "Withdraw" },
  { id: "activity", label: "Activity" },
]

const primaryRails = ["Base", "Solana", "Bitcoin Lightning"] as const

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

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
      message={
        kind === "missing-env"
          ? "PineTree Wallet setup is not configured for this deployment."
          : "PineTree Wallet setup could not load. Refresh the page and try again."
      }
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

// ---------------------------------------------------------------------------
// Dev diagnostics (hidden in production)
// ---------------------------------------------------------------------------

function WalletDiagnosticsPanel({
  wallets,
  sdkNetworkGroups,
}: {
  wallets: ReturnType<typeof useUserWallets>
  sdkNetworkGroups: Record<NetworkId, AddressEntry[]>
}) {
  function sanitizeAdditionalAddress(extra: DynamicAddressMetadata, index: number) {
    const address = typeof extra.address === "string" ? extra.address : ""
    return {
      index,
      hasAddress: Boolean(address),
      addressPrefix: address ? shortAddress(address) : "none",
      addressType: extra.addressType ? String(extra.addressType) : "",
      type: extra.type ? String(extra.type) : "",
      chain: extra.chain ? String(extra.chain) : "",
      network: extra.network ? String(extra.network) : "",
      label: extra.label ? String(extra.label) : "",
      name: extra.name ? String(extra.name) : "",
      key: extra.key ? String(extra.key) : "",
    }
  }

  const rows = wallets.map((w) => ({
    walletId: w.id,
    key: w.key,
    connectorName: w.connector.name,
    connectorKey: String((w.connector as unknown as Record<string, unknown>)["key"] ?? ""),
    chain: w.chain,
    detectedNetwork: networkForWallet(
      w.chain,
      w.key,
      w.connector.name,
      String((w.connector as unknown as Record<string, unknown>)["key"] ?? "")
    ),
    hasAddress: Boolean(w.address),
    addressPrefix: w.address ? `${w.address.slice(0, 6)}…` : "—",
    extraAddressCount: (w.additionalAddresses ?? []).length,
    additionalAddresses: (w.additionalAddresses ?? []).map((extra, index) =>
      sanitizeAdditionalAddress(extra as DynamicAddressMetadata, index)
    ),
  }))

  useEffect(() => {
    console.debug("[pinetree-wallets] sdk diagnostics", {
      walletCount: wallets.length,
      wallets: rows,
      sdkSummary: {
        base: sdkNetworkGroups.base.length,
        solana: sdkNetworkGroups.solana.length,
        lightning: sdkNetworkGroups.lightning.length,
        bitcoin: sdkNetworkGroups.bitcoin.length,
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
              <span><span className="text-yellow-600">id:</span> {row.walletId}</span>
              <span><span className="text-yellow-600">key:</span> {row.key}</span>
              <span><span className="text-yellow-600">chain:</span> {row.chain}</span>
              <span><span className="text-yellow-600">connector:</span> {row.connectorName}{row.connectorKey ? ` [${row.connectorKey}]` : ""}</span>
              <span><span className="text-yellow-600">addr:</span> {row.addressPrefix}</span>
              {row.extraAddressCount > 0 ? (
                <span>
                  <span className="text-yellow-600">+extra:</span>{" "}
                  {row.additionalAddresses.map((extra) => (
                    <span key={extra.index}>
                      #{extra.index} {extra.addressPrefix}
                      {extra.addressType ? ` addressType=${extra.addressType}` : ""}
                      {extra.type ? ` type=${extra.type}` : ""}
                      {extra.chain ? ` chain=${extra.chain}` : ""}
                      {extra.network ? ` network=${extra.network}` : ""}
                      {extra.label ? ` label=${extra.label}` : ""}
                      {extra.name ? ` name=${extra.name}` : ""}
                      {extra.key ? ` key=${extra.key}` : ""}
                    </span>
                  ))}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-3 text-yellow-700">
        <span>lightning: {sdkNetworkGroups.lightning.length}</span>
        <span>base: {sdkNetworkGroups.base.length}</span>
        <span>solana: {sdkNetworkGroups.solana.length}</span>
        <span>btc: {sdkNetworkGroups.bitcoin.length}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Receive row (inside modal, used for Base and Solana)
// ---------------------------------------------------------------------------

function ReceiveRow({
  label,
  entries,
  copiedAddress,
  onCopy,
}: {
  label: string
  entries: AddressEntry[]
  copiedAddress: string
  onCopy: (address: string) => void
}) {
  const ready = entries.length > 0
  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white px-4 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)] sm:px-5 sm:py-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-gray-800">{label}</p>
        <ProviderStatusPill label={ready ? "Ready" : "Setup pending"} tone={ready ? "green" : "amber"} />
      </div>
      <div className="mt-3 space-y-3">
        {ready ? (
          entries.map((entry) => (
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
                onClick={() => onCopy(entry.address)}
                aria-label={`Copy ${label}`}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition hover:text-blue-700"
              >
                {copiedAddress === entry.address ? <CheckCircle2 size={15} /> : <Copy size={15} />}
              </button>
            </div>
          ))
        ) : (
          <p className="text-sm text-amber-700">Setup pending</p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main runtime component
// ---------------------------------------------------------------------------

function PineTreeWalletRuntime() {
  // --- Supabase session & DB profiles ---
  const [profileState, setProfileState] = useState<ProfileState>({ kind: "loading" })
  const [lightningProfileState, setLightningProfileState] = useState<LightningProfileState>({ kind: "loading" })
  const accessTokenRef = useRef<string | null>(null)

  // --- Dynamic SDK ---
  const { user, sdkHasLoaded, setShowAuthFlow, handleLogOut } = useDynamicContext()
  const wallets = useUserWallets()

  // --- UI state ---
  const [sdkTimedOut, setSdkTimedOut] = useState(false)
  const [walletOpen, setWalletOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<WalletTab>("overview")
  // pendingSync: merchant explicitly clicked "Create PineTree Wallet"
  const [pendingSync, setPendingSync] = useState(false)
  // logoutPending: waiting for Dynamic logout to complete before opening auth flow
  const [logoutPending, setLogoutPending] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [enablingLightning, setEnablingLightning] = useState(false)
  const [copiedAddress, setCopiedAddress] = useState("")

  // --- SDK load timeout ---
  useEffect(() => {
    if (sdkHasLoaded) return
    const timer = window.setTimeout(() => setSdkTimedOut(true), 12000)
    return () => window.clearTimeout(timer)
  }, [sdkHasLoaded])

  // --- Escape key closes modal ---
  useEffect(() => {
    if (!walletOpen) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setWalletOpen(false)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [walletOpen])

  // --- Load both profiles from DB on mount ---
  const fetchAllProfiles = useCallback(async () => {
    setProfileState({ kind: "loading" })
    setLightningProfileState({ kind: "loading" })
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) {
        setProfileState({ kind: "none" })
        setLightningProfileState({ kind: "none" })
        return
      }
      accessTokenRef.current = token

      const [walletRes, lightningRes] = await Promise.all([
        fetch("/api/wallets/pinetree-profile", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/wallets/lightning/pinetree-managed", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])

      if (!walletRes.ok) {
        setProfileState({ kind: "error" })
      } else {
        const json = (await walletRes.json()) as { profile: PineTreeWalletProfile | null }
        setProfileState(json.profile ? { kind: "loaded", profile: json.profile } : { kind: "none" })
      }

      // Lightning profile is non-critical; don't block wallet display on failure
      if (lightningRes.ok) {
        const json = (await lightningRes.json()) as { profile: MerchantLightningProfile | null }
        setLightningProfileState(json.profile ? { kind: "loaded", profile: json.profile } : { kind: "none" })
      } else {
        setLightningProfileState({ kind: "none" })
      }
    } catch {
      setProfileState({ kind: "error" })
      setLightningProfileState({ kind: "none" })
    }
  }, [])

  useEffect(() => {
    void fetchAllProfiles()
  }, [fetchAllProfiles])

  // --- Live Dynamic wallet addresses — used only for sync, never for display ---
  const dynamicNetworkAddresses = useMemo(() => {
    return extractDynamicWalletAddresses(wallets as DynamicWalletAddressSource[])
  }, [wallets])

  // --- Sync Dynamic wallet addresses (Base/Solana) to the merchant profile DB record ---
  const syncProfileFromDynamic = useCallback(async () => {
    const token = accessTokenRef.current
    if (!token || !user) return
    if (dynamicNetworkAddresses.base.length === 0 && dynamicNetworkAddresses.solana.length === 0) return

    setSyncing(true)
    try {
      // Lightning readiness is managed by merchant_lightning_profiles, not by Dynamic Spark addresses.
      // We still store any Spark address returned by Dynamic for reference, but it does not drive readiness.
      const body = {
        dynamic_user_id: user.userId,
        base_address: dynamicNetworkAddresses.base[0]?.address ?? null,
        solana_address: dynamicNetworkAddresses.solana[0]?.address ?? null,
        bitcoin_lightning_address: dynamicNetworkAddresses.lightning[0]?.address ?? null,
        bitcoin_onchain_address: dynamicNetworkAddresses.bitcoin[0]?.address ?? null,
      }
      const res = await fetch("/api/wallets/pinetree-profile", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const json = (await res.json()) as { profile: PineTreeWalletProfile }
        setProfileState({ kind: "loaded", profile: json.profile })
      }
    } finally {
      setSyncing(false)
      setPendingSync(false)
    }
  }, [user, dynamicNetworkAddresses])

  // --- After wallet creation: auto-sync addresses to DB ---
  useEffect(() => {
    if (!pendingSync) return
    if (!sdkHasLoaded || !user || wallets.length === 0) return
    void syncProfileFromDynamic()
  }, [pendingSync, sdkHasLoaded, user, wallets, syncProfileFromDynamic])

  // --- After Dynamic logout: open auth flow for the new merchant's wallet creation ---
  useEffect(() => {
    if (!logoutPending) return
    if (user !== null) return // still waiting for logout to clear the user
    setLogoutPending(false)
    setPendingSync(true)
    setShowAuthFlow(true)
  }, [logoutPending, user, setShowAuthFlow])

  // ---------------------------------------------------------------------------
  // Derived state — wallet profile (Base/Solana from Dynamic, DB-backed)
  // ---------------------------------------------------------------------------

  const profile = profileState.kind === "loaded" ? profileState.profile : null

  const profileAddresses = useMemo((): Record<"base" | "solana" | "bitcoin", AddressEntry[]> => {
    if (!profile) return { base: [], solana: [], bitcoin: [] }
    return {
      base: profile.base_address ? [{ id: "base", address: profile.base_address }] : [],
      solana: profile.solana_address ? [{ id: "solana", address: profile.solana_address }] : [],
      bitcoin: profile.bitcoin_onchain_address ? [{ id: "bitcoin-onchain", address: profile.bitcoin_onchain_address }] : [],
    }
  }, [profile])

  const baseReady = profileAddresses.base.length > 0
  const solanaReady = profileAddresses.solana.length > 0

  // ---------------------------------------------------------------------------
  // Derived state — Lightning (PineTree-managed backend, NOT Dynamic Spark)
  // ---------------------------------------------------------------------------

  const lightningProfile = lightningProfileState.kind === "loaded" ? lightningProfileState.profile : null

  // Bitcoin Lightning readiness is driven by the merchant_lightning_profiles record.
  // A Dynamic Spark address is NOT required for Lightning readiness.
  const lightningReady = lightningProfile?.status === "ready"
  const lightningPending = lightningProfile?.status === "pending"
  const lightningEnabled = lightningReady || lightningPending

  const allPrimaryRailsReady = baseReady && solanaReady && lightningReady

  // Wallet exists once Dynamic wallet (Base or Solana) or Lightning profile is active
  const hasWallet = profileState.kind === "loaded" && (baseReady || solanaReady || lightningReady)

  const walletStatus = !hasWallet ? "Not created" : allPrimaryRailsReady ? "Ready" : "Needs attention"
  const statusTone = !hasWallet ? "slate" : allPrimaryRailsReady ? "green" : "amber"

  // ---------------------------------------------------------------------------
  // Dynamic session mismatch guard
  // ---------------------------------------------------------------------------
  const dynamicSessionMatchesProfile =
    !profile?.dynamic_user_id ||
    !user ||
    profile.dynamic_user_id === user.userId

  const hasStaleDynamicSession =
    user !== null &&
    profileState.kind === "none"

  const canRefresh = sdkHasLoaded && dynamicSessionMatchesProfile && user !== null && hasWallet

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address)
      setCopiedAddress(address)
      window.setTimeout(() => setCopiedAddress(""), 1800)
    } catch {
      setCopiedAddress("")
    }
  }

  function handleOpenWallet() {
    setActiveTab("overview")
    setWalletOpen(true)
  }

  function handleCreateWallet() {
    if (hasStaleDynamicSession && user) {
      setLogoutPending(true)
      void handleLogOut?.()
      return
    }
    setPendingSync(true)
    setShowAuthFlow(true)
  }

  async function handleRefreshAddresses() {
    if (!canRefresh) return
    setRefreshing(true)
    try {
      await syncProfileFromDynamic()
    } finally {
      setRefreshing(false)
    }
  }

  async function handleEnableLightning() {
    const token = accessTokenRef.current
    if (!token || enablingLightning) return
    setEnablingLightning(true)
    try {
      const res = await fetch("/api/wallets/lightning/pinetree-managed", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        const json = (await res.json()) as { profile: MerchantLightningProfile }
        setLightningProfileState({ kind: "loaded", profile: json.profile })
      }
    } finally {
      setEnablingLightning(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Early returns
  // ---------------------------------------------------------------------------

  if (sdkTimedOut && !sdkHasLoaded) return <WalletSetupUnavailable kind="sdk" />

  if (profileState.kind === "loading" || lightningProfileState.kind === "loading" || (!sdkHasLoaded && profileState.kind !== "error")) {
    return (
      <WalletProfileShell
        status="Loading"
        tone="blue"
        message="Loading this merchant's PineTree Wallet profile."
      />
    )
  }

  if (profileState.kind === "error") {
    return (
      <WalletProfileShell
        status="Needs attention"
        tone="amber"
        message="Could not load the wallet profile. Refresh the page and try again."
      />
    )
  }

  // ---------------------------------------------------------------------------
  // Lightning status copy helpers
  // ---------------------------------------------------------------------------

  function lightningStatusLabel() {
    if (lightningReady) return "Ready"
    if (lightningPending) return "Pending"
    return "Setup pending"
  }

  function lightningStatusTone(): "green" | "blue" | "amber" {
    if (lightningReady) return "green"
    if (lightningPending) return "blue"
    return "amber"
  }

  function lightningOverviewCopy() {
    if (lightningReady) return "Bitcoin Lightning payments are active through PineTree."
    if (lightningPending) return "PineTree is enabling your Lightning rail. This may take a moment."
    return "Bitcoin Lightning is powered by PineTree's backend Lightning rail. No external merchant wallet connection is required."
  }

  // ---------------------------------------------------------------------------
  // Main card
  // ---------------------------------------------------------------------------

  return (
    <>
      <article className="min-h-[230px] rounded-[1.35rem] border border-blue-200/70 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.13),transparent_38%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(247,251,255,0.96))] p-6 shadow-[0_20px_55px_rgba(37,99,235,0.12)] backdrop-blur sm:p-8">
        <div className="flex h-full flex-wrap items-start justify-between gap-8">
          <div className="max-w-2xl space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-gray-950">PineTree Wallet</h2>
              <ProviderStatusPill
                label={syncing ? "Saving…" : walletStatus}
                tone={syncing ? "blue" : (statusTone as "green" | "amber" | "slate")}
              />
            </div>
            <p className="text-sm leading-6 text-gray-600">
              One merchant wallet for receiving funds and managing PineTree&apos;s supported payment rails.
            </p>
            <div className="flex flex-wrap gap-2.5" aria-label="Supported rails">
              {primaryRails.map((rail) => (
                <span key={rail} className="rounded-full border border-blue-100 bg-blue-50/80 px-2.5 py-1 text-xs font-semibold text-blue-700">
                  {rail}
                </span>
              ))}
            </div>

            {!lightningReady && hasWallet ? (
              <p className="text-xs font-semibold text-amber-700">
                Bitcoin Lightning setup pending
              </p>
            ) : null}

            {!dynamicSessionMatchesProfile ? (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
                <p className="text-xs leading-5 text-amber-800">
                  PineTree Wallet session not active for this account. Click &ldquo;Open PineTree Wallet&rdquo; to reconnect.
                </p>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col items-end gap-2">
            {hasWallet ? (
              <button
                type="button"
                onClick={handleOpenWallet}
                disabled={syncing}
                className="h-10 rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
              >
                Open PineTree Wallet
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCreateWallet}
                disabled={syncing || logoutPending}
                className="h-10 rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
              >
                {logoutPending ? "Preparing…" : "Create PineTree Wallet"}
              </button>
            )}

            {hasWallet && !lightningEnabled ? (
              <button
                type="button"
                onClick={() => void handleEnableLightning()}
                disabled={enablingLightning}
                aria-label="Enable Bitcoin Lightning"
                className="flex h-9 items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 text-xs font-semibold text-orange-700 shadow-sm transition hover:bg-orange-100 disabled:opacity-50"
              >
                <Zap size={12} />
                {enablingLightning ? "Enabling…" : "Enable Bitcoin Lightning"}
              </button>
            ) : null}

            {canRefresh ? (
              <button
                type="button"
                onClick={() => void handleRefreshAddresses()}
                disabled={refreshing}
                aria-label="Refresh wallet addresses"
                className="flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 shadow-sm transition hover:text-blue-700 disabled:opacity-50"
              >
                <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
                Refresh wallet addresses
              </button>
            ) : null}
          </div>
        </div>
      </article>

      {process.env.NODE_ENV !== "production" ? (
        <WalletDiagnosticsPanel wallets={wallets} sdkNetworkGroups={dynamicNetworkAddresses} />
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
                <p className="mt-1 text-xs text-gray-500">One merchant wallet profile</p>
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

            <nav
              className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-gray-100 px-4 py-3 sm:px-6"
              aria-label="PineTree Wallet sections"
            >
              {walletTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`shrink-0 rounded-xl px-4 py-2.5 text-xs font-semibold transition ${
                    activeTab === tab.id
                      ? "bg-[#0052FF] text-white"
                      : "text-gray-500 hover:bg-gray-100 hover:text-gray-800"
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
                    <div className="rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-blue-900">Base</p>
                        <ProviderStatusPill label={baseReady ? "Ready" : "Setup pending"} tone={baseReady ? "green" : "amber"} />
                      </div>
                      <p className="mt-2 text-xs text-blue-700">
                        {baseReady ? "Address available" : "Address setup pending"}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-blue-900">Solana</p>
                        <ProviderStatusPill label={solanaReady ? "Ready" : "Setup pending"} tone={solanaReady ? "green" : "amber"} />
                      </div>
                      <p className="mt-2 text-xs text-blue-700">
                        {solanaReady ? "Address available" : "Address setup pending"}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-blue-900">Bitcoin Lightning / Spark</p>
                        <ProviderStatusPill label={lightningStatusLabel()} tone={lightningStatusTone()} />
                      </div>
                      <p className="mt-2 text-xs text-blue-700">{lightningOverviewCopy()}</p>
                      {!lightningEnabled ? (
                        <button
                          type="button"
                          onClick={() => void handleEnableLightning()}
                          disabled={enablingLightning}
                          className="mt-3 flex items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 transition hover:bg-orange-100 disabled:opacity-50"
                        >
                          <Zap size={11} />
                          {enablingLightning ? "Enabling…" : "Enable Bitcoin Lightning"}
                        </button>
                      ) : null}
                    </div>
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
                  <ReceiveRow label="Base address" entries={profileAddresses.base} copiedAddress={copiedAddress} onCopy={(a) => void copyAddress(a)} />
                  <ReceiveRow label="Solana address" entries={profileAddresses.solana} copiedAddress={copiedAddress} onCopy={(a) => void copyAddress(a)} />

                  {/* Bitcoin Lightning: PineTree-managed, no merchant-side address to copy */}
                  <div className="rounded-2xl border border-gray-200/80 bg-white px-4 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)] sm:px-5 sm:py-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-gray-800">Bitcoin Lightning</p>
                      <ProviderStatusPill label={lightningStatusLabel()} tone={lightningStatusTone()} />
                    </div>
                    <p className="mt-2 text-xs leading-5 text-gray-500">
                      Bitcoin Lightning is powered by PineTree&apos;s backend Lightning rail. No external merchant wallet connection is required.
                    </p>
                    {lightningReady ? (
                      <p className="mt-1 text-xs font-semibold text-green-700">Active — customers can pay Lightning invoices.</p>
                    ) : lightningPending ? (
                      <p className="mt-1 text-xs font-semibold text-blue-700">PineTree is enabling your Lightning rail.</p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleEnableLightning()}
                        disabled={enablingLightning}
                        className="mt-2 flex items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 transition hover:bg-orange-100 disabled:opacity-50"
                      >
                        <Zap size={11} />
                        {enablingLightning ? "Enabling…" : "Enable Bitcoin Lightning"}
                      </button>
                    )}
                  </div>

                  {profileAddresses.bitcoin.length ? (
                    <div className="pt-2">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Secondary</p>
                      <ReceiveRow label="Bitcoin on-chain address" entries={profileAddresses.bitcoin} copiedAddress={copiedAddress} onCopy={(a) => void copyAddress(a)} />
                    </div>
                  ) : null}
                </div>
              ) : null}

              {activeTab === "withdraw" ? (
                <div className="space-y-5">
                  <div>
                    <p className="text-sm font-semibold text-gray-950">Prepare a withdrawal</p>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      Withdrawals are being prepared. No funds will move from this screen yet.
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
                      Review withdrawal — disabled
                    </button>
                  </div>
                </div>
              ) : null}

              {activeTab === "activity" ? (
                <EmptyWalletPanel
                  title="Wallet activity will appear here."
                  detail="Wallet activity syncing is not enabled yet."
                />
              ) : null}

            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

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
