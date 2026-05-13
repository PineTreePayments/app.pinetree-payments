"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabaseClient"
import {
  CompactMetricTile,
  DashboardHeroCard,
  DashboardSection,
  MetricGrid,
  PineTreeInsightsCard,
} from "@/components/dashboard/DashboardPrimitives"
import Button from "@/components/ui/Button"

type CheckoutLinkStatus = "active" | "disabled" | "expired"

type CheckoutLink = {
  id: string
  public_token: string
  name: string
  description: string | null
  amount: number
  currency: string
  customer_email: string | null
  reference: string | null
  status: CheckoutLinkStatus
  expires_at: string | null
  created_at: string
  checkoutUrl: string
  resolvedStatus: CheckoutLinkStatus
}

type Expiration = "never" | "24h" | "7d" | "30d"

const EXPIRATION_LABELS: Record<Expiration, string> = {
  never: "Never",
  "24h": "24 Hours",
  "7d": "7 Days",
  "30d": "30 Days",
}

function fmtUsd(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number.isFinite(n) ? n : 0
  )
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function statusPill(status: CheckoutLinkStatus) {
  const styles: Record<CheckoutLinkStatus, string> = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    disabled: "bg-gray-100 text-gray-500 border-gray-200",
    expired: "bg-amber-50 text-amber-700 border-amber-200",
  }
  const labels: Record<CheckoutLinkStatus, string> = {
    active: "Active",
    disabled: "Disabled",
    expired: "Expired",
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-none ${styles[status]}`}
    >
      {labels[status]}
    </span>
  )
}

export default function OnlineCheckoutPage() {
  const [links, setLinks] = useState<CheckoutLink[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [disablingId, setDisablingId] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState("")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [customerEmail, setCustomerEmail] = useState("")
  const [reference, setReference] = useState("")
  const [expiration, setExpiration] = useState<Expiration>("never")
  const [formError, setFormError] = useState("")

  const authRef = useRef<string>("")

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    authRef.current = data.session?.access_token ?? ""
    return authRef.current
  }, [])

  const fetchLinks = useCallback(async () => {
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch("/api/checkout-links", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      if (!res.ok) return
      const data = (await res.json()) as { links: CheckoutLink[] }
      setLinks(data.links ?? [])
    } catch {
      // silent — links list will remain empty
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => {
    void fetchLinks()
  }, [fetchLinks])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError("")
    const parsedAmount = parseFloat(amount)
    if (!name.trim()) {
      setFormError("Link name is required.")
      return
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError("Enter a valid amount.")
      return
    }
    setSubmitting(true)
    try {
      const token = await getToken()
      const res = await fetch("/api/checkout-links", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          amount: parsedAmount,
          description: description.trim() || undefined,
          customerEmail: customerEmail.trim() || undefined,
          reference: reference.trim() || undefined,
          expiration,
        }),
      })
      const data = (await res.json()) as { link?: CheckoutLink; error?: string }
      if (!res.ok) throw new Error(data.error || "Failed to create link")
      if (data.link) {
        setLinks((prev) => [data.link!, ...prev])
        toast.success("Checkout link created")
        setName("")
        setAmount("")
        setDescription("")
        setCustomerEmail("")
        setReference("")
        setExpiration("never")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create link")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDisable(id: string) {
    setDisablingId(id)
    try {
      const token = await getToken()
      const res = await fetch(`/api/checkout-links/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: "disabled" }),
      })
      const data = (await res.json()) as { link?: CheckoutLink; error?: string }
      if (!res.ok) throw new Error(data.error || "Failed to disable link")
      if (data.link) {
        setLinks((prev) => prev.map((l) => (l.id === id ? (data.link as CheckoutLink) : l)))
        toast.success("Link disabled")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disable link")
    } finally {
      setDisablingId(null)
    }
  }

  async function handleCopy(id: string, url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1800)
    } catch {
      toast.error("Could not copy to clipboard")
    }
  }

  // Derived summary stats
  const activeLinks = links.filter((l) => l.resolvedStatus === "active").length
  const onlinePayments = 0  // placeholder until transaction join is available
  const onlineVolume = 0     // placeholder until transaction join is available
  const successRate = null   // placeholder

  // Insights
  const insights: string[] = []
  if (activeLinks > 0) {
    insights.push(`${activeLinks} active checkout link${activeLinks !== 1 ? "s" : ""} ready to accept payments.`)
  }
  if (links.length === 0 && !loading) {
    insights.push("Create your first checkout link to start accepting online payments.")
  }
  const disabledCount = links.filter((l) => l.resolvedStatus === "disabled").length
  if (disabledCount > 0) {
    insights.push(`${disabledCount} link${disabledCount !== 1 ? "s" : ""} currently disabled.`)
  }

  return (
    <div className="space-y-6 md:space-y-8">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <DashboardHeroCard
        eyebrow="Online Checkout"
        title="Create payment links for online customers."
        value={loading ? "—" : `${activeLinks} Active`}
        detail="Share links on your website, invoices, or anywhere customers pay online."
      />

      {/* ── Summary cards ────────────────────────────────────────────────── */}
      <MetricGrid columns="four">
        <CompactMetricTile
          label="Active Links"
          value={loading ? "—" : String(activeLinks)}
          tone="blue"
        />
        <CompactMetricTile
          label="Online Payments"
          value={loading ? "—" : String(onlinePayments)}
          tone="default"
          detail="Coming soon"
        />
        <CompactMetricTile
          label="Online Volume"
          value={loading ? "—" : fmtUsd(onlineVolume)}
          tone="green"
          detail="Coming soon"
        />
        <CompactMetricTile
          label="Success Rate"
          value={successRate !== null ? `${successRate}%` : "—"}
          tone="default"
          detail="Coming soon"
        />
      </MetricGrid>

      {/* ── Create link ──────────────────────────────────────────────────── */}
      <DashboardSection title="Create Checkout Link">
        <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-6">
          <form onSubmit={(e) => void handleCreate(e)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">
                  Link Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Product Payment, Invoice #42"
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-[#0052FF] focus:ring-2 focus:ring-[#0052FF]/10"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">
                  Amount (USD) <span className="text-red-400">*</span>
                </label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  min="0.01"
                  step="0.01"
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-[#0052FF] focus:ring-2 focus:ring-[#0052FF]/10"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional — shown to customer"
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-[#0052FF] focus:ring-2 focus:ring-[#0052FF]/10"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">
                  Customer Email
                </label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="customer@example.com"
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-[#0052FF] focus:ring-2 focus:ring-[#0052FF]/10"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">
                  Reference / Order ID
                </label>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Optional order reference"
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-[#0052FF] focus:ring-2 focus:ring-[#0052FF]/10"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">
                Link Expiration
              </label>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(EXPIRATION_LABELS) as Expiration[]).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setExpiration(opt)}
                    className={`rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all ${
                      expiration === opt
                        ? "border-[#0052FF]/30 bg-[#0052FF]/8 text-[#0052FF] shadow-sm shadow-[#0052FF]/10"
                        : "border-gray-200 bg-white text-gray-600 hover:border-[#0052FF]/20 hover:text-[#0052FF]"
                    }`}
                  >
                    {EXPIRATION_LABELS[opt]}
                  </button>
                ))}
              </div>
            </div>

            {formError && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {formError}
              </p>
            )}

            <div className="pt-1">
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <span className="mr-2 inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin" />
                    Creating…
                  </>
                ) : (
                  "Create Checkout Link"
                )}
              </Button>
            </div>
          </form>
        </div>
      </DashboardSection>

      {/* ── Links list ───────────────────────────────────────────────────── */}
      <DashboardSection title="Checkout Links">
        {loading ? (
          <div className="rounded-2xl border border-gray-200/80 bg-white p-8 shadow-[0_10px_30px_rgba(15,23,42,0.05)] text-center">
            <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-[#0052FF] border-t-transparent" />
          </div>
        ) : links.length === 0 ? (
          <div className="rounded-2xl border border-gray-200/80 bg-white p-8 shadow-[0_10px_30px_rgba(15,23,42,0.05)] text-center">
            <p className="text-sm text-gray-500">No checkout links yet. Create one above.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">
                      Name
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">
                      Amount
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">
                      Status
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">
                      Created
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">
                      Expires
                    </th>
                    <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {links.map((link) => (
                    <tr key={link.id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-5 py-4">
                        <div className="font-medium text-gray-900">{link.name}</div>
                        {link.description && (
                          <div className="mt-0.5 text-xs text-gray-400 truncate max-w-[200px]">
                            {link.description}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4 font-semibold text-gray-900">
                        {fmtUsd(Number(link.amount))}
                      </td>
                      <td className="px-5 py-4">{statusPill(link.resolvedStatus)}</td>
                      <td className="px-5 py-4 text-gray-500">{fmtDate(link.created_at)}</td>
                      <td className="px-5 py-4 text-gray-500">
                        {link.expires_at ? fmtDate(link.expires_at) : "Never"}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => void handleCopy(link.id, link.checkoutUrl)}
                            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-[#0052FF]/30 hover:text-[#0052FF] transition-colors"
                          >
                            {copiedId === link.id ? "Copied ✓" : "Copy Link"}
                          </button>
                          <a
                            href={link.checkoutUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-[#0052FF]/30 hover:text-[#0052FF] transition-colors"
                          >
                            Open ↗
                          </a>
                          {link.resolvedStatus === "active" && (
                            <button
                              onClick={() => void handleDisable(link.id)}
                              disabled={disablingId === link.id}
                              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                            >
                              {disablingId === link.id ? "…" : "Disable"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className="divide-y divide-gray-100 md:hidden">
              {links.map((link) => (
                <div key={link.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{link.name}</p>
                      {link.description && (
                        <p className="mt-0.5 text-xs text-gray-400 truncate">{link.description}</p>
                      )}
                    </div>
                    <div className="shrink-0">{statusPill(link.resolvedStatus)}</div>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="font-semibold text-gray-900">{fmtUsd(Number(link.amount))}</span>
                    <span className="text-gray-400">{fmtDate(link.created_at)}</span>
                    {link.expires_at && (
                      <span className="text-gray-400">Exp {fmtDate(link.expires_at)}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void handleCopy(link.id, link.checkoutUrl)}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-[#0052FF]/30 hover:text-[#0052FF] transition-colors"
                    >
                      {copiedId === link.id ? "Copied ✓" : "Copy Link"}
                    </button>
                    <a
                      href={link.checkoutUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-[#0052FF]/30 hover:text-[#0052FF] transition-colors"
                    >
                      Open ↗
                    </a>
                    {link.resolvedStatus === "active" && (
                      <button
                        onClick={() => void handleDisable(link.id)}
                        disabled={disablingId === link.id}
                        className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        {disablingId === link.id ? "…" : "Disable"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </DashboardSection>

      {/* ── PineTree Insights ─────────────────────────────────────────────── */}
      <PineTreeInsightsCard
        insights={insights}
        emptyText="Insights will appear once checkout links are created and payments begin."
      />
    </div>
  )
}
