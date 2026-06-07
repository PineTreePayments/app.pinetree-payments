"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"
import { DashboardSection } from "@/components/dashboard/DashboardPrimitives"
import Link from "next/link"
import ToggleSwitch from "@/components/ui/ToggleSwitch"

type MerchantSettingsPayload = {
  business_name: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  phone: string | null
  business_type: string | null
  closeout_time: string
  report_toast: boolean
}

type MerchantTaxSettingsPayload = {
  tax_enabled: boolean
  tax_rate: number
  tax_name: string
}

type SettingsApiResponse = {
  success?: boolean
  settings?: MerchantSettingsPayload
  tax?: MerchantTaxSettingsPayload
  error?: string
}

type ProviderSummary = {
  provider: string
  status: string
  enabled: boolean
}

function parseCloseoutTime(value: string) {
  const normalized = value.trim()
  const [hour24, minute = "00"] = normalized.split(":")
  const hourNum = Number(hour24)

  return {
    hour: String(Number.isFinite(hourNum) ? hourNum : 12).padStart(2, "0"),
    minute: minute.padStart(2, "0")
  }
}

export default function SettingsPage() {
  const [businessName, setBusinessName] = useState("")
  const [email, setEmail] = useState("")

  const [address, setAddress] = useState("")
  const [city, setCity] = useState("")
  const [state, setState] = useState("")
  const [zip, setZip] = useState("")
  const [country, setCountry] = useState("")
  const [phone, setPhone] = useState("")
  const [businessType, setBusinessType] = useState("")

  const [closeHour, setCloseHour] = useState("12")
  const [closeMinute, setCloseMinute] = useState("00")
  const [reportToast, setReportToast] = useState(true)

  const [taxEnabled, setTaxEnabled] = useState(false)
  const [taxRate, setTaxRate] = useState("")
  const [taxName, setTaxName] = useState("Sales Tax")

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [providerSummary, setProviderSummary] = useState<ProviderSummary[]>([])

  const callSettingsApi = useCallback(async (method: "GET" | "POST", body?: unknown) => {
    const {
      data: { session }
    } = await supabase.auth.getSession()

    const token = session?.access_token
    if (!token) {
      throw new Error("User not authenticated")
    }

    const res = await fetch("/api/settings", {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: method === "POST" ? JSON.stringify(body || {}) : undefined,
      credentials: "include",
      cache: "no-store"
    })

    const payload = (await res.json().catch(() => null)) as SettingsApiResponse | null

    if (!res.ok) {
      throw new Error(payload?.error || "Settings request failed")
    }

    return payload || {}
  }, [])

  const applyPayload = useCallback((payload: SettingsApiResponse) => {
    const settings = payload.settings
    const tax = payload.tax

    if (settings) {
      setBusinessName(settings.business_name || "")
      setAddress(settings.address || "")
      setCity(settings.city || "")
      setState(settings.state || "")
      setZip(settings.zip || "")
      setCountry(settings.country || "")
      setPhone(settings.phone || "")
      setBusinessType(settings.business_type || "")
      setReportToast(settings.report_toast ?? true)

      const parsed = parseCloseoutTime(settings.closeout_time || "12:00")
      setCloseHour(parsed.hour)
      setCloseMinute(parsed.minute)
    }

    if (tax) {
      setTaxEnabled(Boolean(tax.tax_enabled))
      setTaxRate(String(tax.tax_rate ?? 0))
      setTaxName(tax.tax_name || "Sales Tax")
    }
  }, [])

  const loadSettings = useCallback(async () => {
    setLoading(true)
    try {
      const {
        data: { user }
      } = await supabase.auth.getUser()

      if (!user) {
        toast.error("User not authenticated")
        return
      }

      setEmail(user.email ?? "")

      const payload = await callSettingsApi("GET")
      applyPayload(payload)

      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) {
        const providerResponse = await fetch("/api/providers", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store"
        })
        if (providerResponse.ok) {
          const providerPayload = await providerResponse.json() as { providers?: ProviderSummary[] }
          setProviderSummary(providerPayload.providers || [])
        }
      }
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Failed to load settings")
    } finally {
      setLoading(false)
    }
  }, [applyPayload, callSettingsApi])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  async function saveSettings() {
    setSaving(true)

    try {
      const payload = await callSettingsApi("POST", {
        settings: {
          business_name: businessName || null,
          address: address || null,
          city: city || null,
          state: state || null,
          zip: zip || null,
          country: country || null,
          phone: phone || null,
          business_type: businessType || null,
          closeout_time: `${closeHour}:${closeMinute}`,
          report_toast: reportToast
        },
        tax: {
          tax_enabled: taxEnabled,
          tax_rate: sanitizeTaxRate(taxRate),
          tax_name: taxName || "Sales Tax"
        }
      })

      applyPayload(payload)
      toast.success("Settings saved")
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  function sanitizeTaxRate(raw: string): number {
    if (raw === "") return 0
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return 0
    // Clamp to [0, 100] — a rate outside this range is almost certainly a typo
    return Math.min(100, Math.max(0, parsed))
  }

  if (loading) {
    return (
      <div className="space-y-5 md:space-y-7">
        <h1 className="text-2xl font-semibold text-gray-950 md:text-3xl">Settings</h1>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 text-gray-700 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">
          Loading settings...
        </div>
      </div>
    )
  }

  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = "/login"
  }

  const enabledRails = providerSummary.filter((provider) =>
    provider.enabled && ["connected", "active"].includes(String(provider.status).toLowerCase())
  )
  const fieldClass = "form-field mt-1.5"
  const labelClass = "text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500"

  return (
    <div className="space-y-5 md:space-y-7">
      <div>
        <h1 className="text-2xl font-semibold text-gray-950 md:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-gray-600">Business, payment, POS, tax, notification, and integration preferences.</p>
      </div>

      <DashboardSection title="Business Profile" titleTone="blue">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className={labelClass}>Business Name</label>
            <input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label className={labelClass}>Contact Email</label>
            <input
              value={email}
              disabled
              className={`${fieldClass} bg-gray-100`}
            />
          </div>

          <div>
            <label className={labelClass}>Business Address</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label className={labelClass}>City</label>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label className={labelClass}>State</label>
            <input
              value={state}
              onChange={(e) => setState(e.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label className={labelClass}>ZIP</label>
            <input
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label className={labelClass}>Country</label>
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label className={labelClass}>Business Phone</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label className={labelClass}>Business Type</label>
            <select
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              className={fieldClass}
            >
              <option value="">Select</option>
              <option value="retail">Retail</option>
              <option value="restaurant">Restaurant</option>
              <option value="services">Services</option>
              <option value="online">Online</option>
            </select>
          </div>
        </div>
      </div>
      </DashboardSection>

      <DashboardSection title="Payment Preferences" titleTone="blue">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-950">Enabled payment rails</h3>
              <p className="mt-1 text-sm leading-6 text-gray-600">This summary reads from existing provider configuration.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {enabledRails.length ? enabledRails.map((provider) => (
                  <span key={provider.provider} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold capitalize text-emerald-700">
                    {provider.provider.replaceAll("_", " ")}
                  </span>
                )) : (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">No enabled rails</span>
                )}
              </div>
            </div>
            <Link href="/dashboard/providers" className="inline-flex min-h-10 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700 hover:bg-blue-100">
              Manage Providers
            </Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <SettingPreview title="Default payment rail" detail="Routing remains controlled by existing provider and routing configuration." />
            <SettingPreview title="PineTree fee display" detail="Fee amounts continue to come from the payment engine and checkout breakdown." />
          </div>
        </div>
      </DashboardSection>

      <DashboardSection title="POS Settings" titleTone="blue">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">
          <div className="grid gap-3 md:grid-cols-3">
            <IntegrationLink title="Terminals & Device Preferences" detail="Manage terminal names, PINs, auto-lock, and drawer setup." href="/dashboard/pos" />
            <SettingPreview title="Receipt Behavior" detail="Configure later. Receipt delivery preferences are not persisted yet." />
            <SettingPreview title="Cash Drawer Preferences" detail="Drawer balances and closeout remain managed per terminal." />
          </div>
        </div>
      </DashboardSection>

      <DashboardSection title="Tax & Fees" titleTone="blue">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50/70 p-4 md:col-span-2">
            <div><p className="text-sm font-semibold text-gray-950">Tax collection</p><p className="mt-0.5 text-xs text-gray-500">Apply the configured tax rate to supported POS sales.</p></div>
            <ToggleSwitch
              checked={taxEnabled}
              onChange={setTaxEnabled}
            />
          </div>

          <div>
            <label className={labelClass}>Tax Name</label>
            <input
              value={taxName}
              onChange={(e) => setTaxName(e.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label className={labelClass}>Tax Rate (%)</label>
            <input
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
              className={fieldClass}
              placeholder="8.25"
            />
          </div>
        </div>
      </div>
      </DashboardSection>

      <DashboardSection title="Notifications & Reporting" titleTone="blue">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className={labelClass}>Business Day Closeout Time</label>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <select
                value={closeHour}
                onChange={(e) => setCloseHour(e.target.value)}
                className="form-field w-24"
              >
                {Array.from({ length: 24 }, (_, i) => {
                  const val = i < 10 ? `0${i}` : `${i}`
                  return (
                    <option key={val} value={val}>
                      {val}
                    </option>
                  )
                })}
              </select>

              <span className="text-gray-900 font-medium">:</span>

              <select
                value={closeMinute}
                onChange={(e) => setCloseMinute(e.target.value)}
                className="form-field w-24"
              >
                {["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"].map((val) => (
                  <option key={val} value={val}>
                    {val}
                  </option>
                ))}
              </select>
            </div>

            <p className="text-xs text-gray-500 mt-2">
              Determines when daily reports and revenue totals reset.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50/70 p-4">
              <div><p className="text-sm font-semibold text-gray-950">End-of-day reminder</p><p className="mt-0.5 text-xs text-gray-500">Show the existing report reminder.</p></div>
              <ToggleSwitch
                checked={reportToast}
                onChange={setReportToast}
              />
            </div>
            <SettingPreview title="Payment success alerts" detail="Configure later. Alert delivery preferences are not persisted yet." />
            <SettingPreview title="Failed payment alerts" detail="Configure later. Existing transaction data remains available in the ledger." />
          </div>
        </div>
      </div>
      </DashboardSection>

      <DashboardSection title="Security & Integrations" titleTone="blue">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="flex min-h-36 flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-gray-950">Account Security</p>
            <p className="mt-1 flex-1 break-all text-xs leading-5 text-gray-500">
              Signed in as {email || "merchant"}. Session security is managed by Supabase Auth.
            </p>
            <button type="button" onClick={() => void signOut()} className="mt-3 w-fit text-sm font-semibold text-red-600 hover:text-red-700">
              Sign out
            </button>
          </div>
          <IntegrationLink title="Wallets" detail="Settlement wallets, balances, send activity, and destinations." href="/dashboard/wallets" />
          <IntegrationLink title="Checkout, Webhooks & API Keys" detail="Manage payment links, webhook delivery, and merchant API keys." href="/dashboard/checkout" />
          <IntegrationLink title="Inventory" detail="Manage the merchant item catalog and stock thresholds." href="/dashboard/inventory" />
        </div>
      </DashboardSection>

      <div className="sticky bottom-3 z-10 rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-[0_16px_40px_rgba(15,23,42,0.12)] backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
        <button
          onClick={saveSettings}
          disabled={saving}
          className="inline-flex min-h-10 w-fit items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60 sm:px-5"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  )
}

function SettingPreview({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-950">{title}</p>
        <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-500">Configure later</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-gray-500">{detail}</p>
    </div>
  )
}

function IntegrationLink({
  title,
  detail,
  href,
  label = "Open"
}: {
  title: string
  detail: string
  href: string
  label?: string
}) {
  return (
    <div className="flex min-h-36 flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-gray-950">{title}</p>
      <p className="mt-1 flex-1 text-xs leading-5 text-gray-500">{detail}</p>
      <Link href={href} className="mt-3 text-sm font-semibold text-blue-600 hover:text-blue-700">{label}</Link>
    </div>
  )
}
