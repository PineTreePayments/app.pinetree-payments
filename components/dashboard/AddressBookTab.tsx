"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Archive, Check, ChevronDown, Copy, Plus, Star } from "lucide-react"
import ToggleSwitch from "@/components/ui/ToggleSwitch"

type Rail = "base" | "solana" | "bitcoin"
type Asset = "ETH" | "USDC" | "SOL" | "BTC"
type Method = "onchain" | "lightning" | null

type Destination = {
  id: string
  rail: Rail
  asset: Asset
  method: Method
  destination_address: string
  label: string
  is_default: boolean
  is_enabled: boolean
  provider_name: string | null
  memo_or_tag: string | null
  confirmation_status: "unconfirmed" | "confirmed"
  merchant_confirmed_at: string | null
  last_used_at: string | null
  archived_at: string | null
  created_at: string
}

const RAIL_ASSETS: Record<Rail, Asset[]> = {
  base: ["ETH", "USDC"],
  solana: ["SOL", "USDC"],
  bitcoin: ["BTC"],
}

const RAIL_LABELS: Record<Rail, string> = { base: "Base", solana: "Solana", bitcoin: "Bitcoin" }

// Same compact dropdown treatment already used for the Network/Time filters
// on the Transactions page (light blue background, blue border, chevron
// overlay) - reused here rather than inventing a new select style.
const compactSelectClass =
  "h-9 w-full min-w-0 appearance-none rounded-lg border border-blue-100 bg-blue-50/40 pl-3 pr-7 text-sm font-normal text-gray-600 outline-none transition hover:border-blue-200 hover:bg-blue-50/70 focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50"

const ADDRESS_PLACEHOLDER: Record<Rail, string> = {
  base: "0x...",
  solana: "Enter a Solana address",
  bitcoin: "Enter a Bitcoin address",
}

function labelPlaceholder(rail: Rail, asset: Asset): string {
  return rail === "bitcoin" ? "e.g. Bitcoin Wallet" : `e.g. ${RAIL_LABELS[rail]} ${asset}`
}

function shortAddress(address: string): string {
  if (address.length <= 14) return address
  if (address.includes("@")) return address
  return `${address.slice(0, 8)}...${address.slice(-6)}`
}

function assetNetworkLabel(destination: Destination): string {
  if (destination.rail === "bitcoin") {
    return destination.method === "lightning" ? "Bitcoin · Lightning" : "Bitcoin · On-chain"
  }
  return `${destination.asset} · ${RAIL_LABELS[destination.rail]}`
}

const CONFIRM_ACK_TEXT =
  "I verified that this destination supports the selected asset and network. Cryptocurrency transfers are irreversible, and PineTree cannot recover funds sent to an incorrect or unsupported destination."

export default function AddressBookTab({ accessToken }: { accessToken: string | null }) {
  const [destinations, setDestinations] = useState<Destination[] | null>(null)
  const [loadError, setLoadError] = useState("")
  const [showAddForm, setShowAddForm] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [confirmAckChecked, setConfirmAckChecked] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState("")

  const [formRail, setFormRail] = useState<Rail>("base")
  const [formAsset, setFormAsset] = useState<Asset>("ETH")
  const [formAddress, setFormAddress] = useState("")
  const [formLabel, setFormLabel] = useState("")
  const [formProvider, setFormProvider] = useState("")
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState("")

  async function loadDestinations() {
    if (!accessToken) return
    try {
      const res = await fetch("/api/wallets/pinetree-wallet/withdrawal-destinations?include_disabled=true", {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const json = await res.json()
      if (!res.ok) {
        setLoadError(json?.error || "Couldn't load saved destinations.")
        return
      }
      setDestinations(json.destinations || [])
    } catch {
      setLoadError("Couldn't load saved destinations.")
    }
  }

  useEffect(() => {
    void loadDestinations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken])

  const grouped = useMemo(() => {
    const active = (destinations || []).filter((d) => !d.archived_at)
    return active
  }, [destinations])

  async function handleToggleEnabled(destination: Destination) {
    if (!accessToken) return
    setBusyId(destination.id)
    setActionError("")
    try {
      const res = await fetch(`/api/wallets/pinetree-wallet/withdrawal-destinations/${destination.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ is_enabled: !destination.is_enabled }),
      })
      const json = await res.json()
      if (!res.ok) {
        setActionError(json?.error || "Couldn't update this destination.")
        return
      }
      await loadDestinations()
    } finally {
      setBusyId(null)
    }
  }

  async function handleSetDefault(destination: Destination) {
    if (!accessToken) return
    setBusyId(destination.id)
    setActionError("")
    try {
      const res = await fetch(`/api/wallets/pinetree-wallet/withdrawal-destinations/${destination.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ is_default: true }),
      })
      const json = await res.json()
      if (!res.ok) {
        setActionError(json?.error || "Couldn't set this destination as default.")
        return
      }
      await loadDestinations()
    } finally {
      setBusyId(null)
    }
  }

  async function handleConfirm(destination: Destination) {
    if (!accessToken || !confirmAckChecked) return
    setBusyId(destination.id)
    setActionError("")
    try {
      const res = await fetch(`/api/wallets/pinetree-wallet/withdrawal-destinations/${destination.id}/confirm`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const json = await res.json()
      if (!res.ok) {
        setActionError(json?.error || "Couldn't confirm this destination.")
        return
      }
      setConfirmingId(null)
      setConfirmAckChecked(false)
      await loadDestinations()
    } finally {
      setBusyId(null)
    }
  }

  async function handleRemove(destination: Destination) {
    if (!accessToken) return
    setBusyId(destination.id)
    setActionError("")
    try {
      const res = await fetch(`/api/wallets/pinetree-wallet/withdrawal-destinations/${destination.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const json = await res.json()
      if (!res.ok) {
        setActionError(json?.error || "Couldn't remove this destination.")
        return
      }
      await loadDestinations()
    } finally {
      setBusyId(null)
    }
  }

  async function handleAddDestination() {
    if (!accessToken) return
    setFormSaving(true)
    setFormError("")
    try {
      const res = await fetch("/api/wallets/pinetree-wallet/withdrawal-destinations", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          rail: formRail,
          asset: formAsset,
          destination_address: formAddress.trim(),
          label: formLabel.trim(),
          provider_name: formProvider.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setFormError(json?.error || "Couldn't save this destination.")
        return
      }
      setShowAddForm(false)
      setFormAddress("")
      setFormLabel("")
      setFormProvider("")
      await loadDestinations()
    } finally {
      setFormSaving(false)
    }
  }

  if (loadError) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
        <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-600" />
        <p className="text-xs leading-5 text-red-700">{loadError}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
          Saved withdrawal destinations
        </p>
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
        >
          <Plus size={13} /> Add
        </button>
      </div>

      {actionError ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-600" />
          <p className="text-xs leading-5 text-red-700">{actionError}</p>
        </div>
      ) : null}

      {showAddForm ? (
        <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.11em] text-gray-600">Network</span>
              <div className="relative">
                <select
                  aria-label="Network"
                  value={formRail}
                  onChange={(event) => {
                    const rail = event.target.value as Rail
                    setFormRail(rail)
                    setFormAsset(RAIL_ASSETS[rail][0])
                  }}
                  className={compactSelectClass}
                >
                  <option value="base">Base</option>
                  <option value="solana">Solana</option>
                  <option value="bitcoin">Bitcoin</option>
                </select>
                <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-blue-300" />
              </div>
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.11em] text-gray-600">Asset</span>
              <div className="relative">
                <select
                  aria-label="Asset"
                  value={formAsset}
                  onChange={(event) => setFormAsset(event.target.value as Asset)}
                  className={compactSelectClass}
                >
                  {RAIL_ASSETS[formRail].map((asset) => (
                    <option key={asset} value={asset}>{asset}</option>
                  ))}
                </select>
                <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-blue-300" />
              </div>
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.11em] text-gray-600">
              {formRail === "bitcoin" ? "Bitcoin address, Lightning Address, or invoice" : "Destination address"}
            </span>
            <input
              value={formAddress}
              onChange={(event) => setFormAddress(event.target.value)}
              placeholder={ADDRESS_PLACEHOLDER[formRail]}
              className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.11em] text-gray-600">Label</span>
              <input
                value={formLabel}
                onChange={(event) => setFormLabel(event.target.value)}
                placeholder={labelPlaceholder(formRail, formAsset)}
                className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.11em] text-gray-600">Provider (optional)</span>
              <input
                value={formProvider}
                onChange={(event) => setFormProvider(event.target.value)}
                placeholder="e.g. Coinbase"
                className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
              />
            </label>
          </div>
          {formError ? <p className="text-xs text-red-600">{formError}</p> : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={formSaving || !formAddress.trim()}
              onClick={() => void handleAddDestination()}
              className="rounded-lg bg-[#0052FF] px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50"
            >
              {formSaving ? "Saving..." : "Save destination"}
            </button>
          </div>
        </div>
      ) : null}

      {destinations === null ? (
        <p className="py-6 text-center text-sm text-gray-500">Loading saved destinations...</p>
      ) : grouped.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">No saved addresses yet.</p>
      ) : (
        <ul className="space-y-2">
          {grouped.map((destination) => (
            <li key={destination.id} className="rounded-xl border border-gray-200/80 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-gray-950">{destination.label || "(no label)"}</p>
                    {destination.is_default ? (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                        <Star size={10} /> Default
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">{assetNetworkLabel(destination)}</p>
                  <p className="mt-1 truncate font-mono text-[11px] text-gray-600">{shortAddress(destination.destination_address)}</p>
                  {destination.provider_name ? (
                    <p className="mt-0.5 text-[11px] text-gray-500">Provider: {destination.provider_name}</p>
                  ) : null}
                  <p className="mt-1 text-[10px] text-gray-400">
                    {destination.confirmation_status === "confirmed" ? "Confirmed by merchant" : "Ready"}
                    {destination.last_used_at ? ` · Last used ${new Date(destination.last_used_at).toLocaleDateString()}` : " · Never used"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <ToggleSwitch checked={destination.is_enabled} onChange={() => void handleToggleEnabled(destination)} disabled={busyId === destination.id} />
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard?.writeText(destination.destination_address)}
                      aria-label="Copy address"
                      className="rounded-md border border-gray-200 p-1 text-gray-500 hover:border-blue-200 hover:text-blue-600"
                    >
                      <Copy size={12} />
                    </button>
                    {!destination.is_default ? (
                      <button
                        type="button"
                        onClick={() => void handleSetDefault(destination)}
                        aria-label="Set as default"
                        className="rounded-md border border-gray-200 p-1 text-gray-500 hover:border-blue-200 hover:text-blue-600"
                      >
                        <Star size={12} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void handleRemove(destination)}
                      aria-label="Remove destination"
                      className="rounded-md border border-gray-200 p-1 text-gray-500 hover:border-red-200 hover:text-red-600"
                    >
                      <Archive size={12} />
                    </button>
                  </div>
                </div>
              </div>

              {destination.confirmation_status !== "confirmed" ? (
                confirmingId === destination.id ? (
                  <div className="mt-2 space-y-2 rounded-lg border border-blue-100 bg-blue-50/50 p-2.5">
                    <label className="flex items-start gap-1.5">
                      <input
                        type="checkbox"
                        checked={confirmAckChecked}
                        onChange={(event) => setConfirmAckChecked(event.target.checked)}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300"
                      />
                      <span className="text-[11px] leading-4 text-gray-700">{CONFIRM_ACK_TEXT}</span>
                    </label>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => { setConfirmingId(null); setConfirmAckChecked(false) }}
                        className="rounded-md border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={!confirmAckChecked || busyId === destination.id}
                        onClick={() => void handleConfirm(destination)}
                        className="inline-flex items-center gap-1 rounded-md bg-[#0052FF] px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                      >
                        <Check size={11} /> Confirm
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(destination.id)}
                    className="mt-2 text-[11px] font-semibold text-blue-700 hover:underline"
                  >
                    Confirm this destination
                  </button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
