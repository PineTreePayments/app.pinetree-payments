"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"
import { DashboardSection } from "@/components/dashboard/DashboardPrimitives"
import Link from "next/link"
import ToggleSwitch from "@/components/ui/ToggleSwitch"

type MerchantSettingsPayload = {
  business_name: string | null
  contact_email: string | null
  address: string | null
  address_line_2: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  phone: string | null
  website: string | null
  business_type: string | null
  closeout_time: string
  report_toast: boolean
}

type MerchantTaxSettingsPayload = {
  tax_enabled: boolean
  tax_rate: number
  tax_name: string
}

type MerchantOperationsSettingsPayload = {
  show_business_name: boolean
  show_business_address: boolean
  show_transaction_id: boolean
  show_network: boolean
  show_provider: boolean
  show_wallet_reference: boolean
  receipt_footer: string | null
  auto_print: boolean
  email_receipt_enabled: boolean
  sms_receipt_enabled: boolean
  cash_drawer_enabled: boolean
  require_cashier_note: boolean
  default_terminal_label: string | null
  receipt_prompt_after_payment: boolean
  tipping_enabled: boolean
  successful_payment_alerts: boolean
  failed_payment_alerts: boolean
  incomplete_payment_alerts: boolean
  daily_summary: boolean
  low_inventory_alerts: boolean
}

type SettingsApiResponse = {
  success?: boolean
  settings?: MerchantSettingsPayload
  tax?: MerchantTaxSettingsPayload
  operations?: MerchantOperationsSettingsPayload
  receiptDevices?: ReceiptDevice[]
  schemaReady?: boolean
  error?: string
}

type ProviderSummary = {
  provider: string
  status: string
  enabled: boolean
}

type IntegrationSummary = {
  wallets: number
  checkoutLinks: number
  webhookConfigured: boolean
  inventoryAvailable: boolean
  inventoryItems: number
}

type ReceiptDevice = {
  label: string
  type: "BROWSER_PRINT" | "TERMINAL_PRINT" | "NETWORK_PRINTER" | "PROVIDER_PRINTER"
  provider: string | null
  status: "AVAILABLE" | "REQUIRES_CONFIGURATION" | "CONNECTED" | "ERROR" | "DISABLED"
}

const defaultOperationsSettings: MerchantOperationsSettingsPayload = {
  show_business_name: true,
  show_business_address: true,
  show_transaction_id: true,
  show_network: true,
  show_provider: true,
  show_wallet_reference: false,
  receipt_footer: null,
  auto_print: false,
  email_receipt_enabled: false,
  sms_receipt_enabled: false,
  cash_drawer_enabled: false,
  require_cashier_note: false,
  default_terminal_label: null,
  receipt_prompt_after_payment: true,
  tipping_enabled: false,
  successful_payment_alerts: true,
  failed_payment_alerts: true,
  incomplete_payment_alerts: true,
  daily_summary: false,
  low_inventory_alerts: true
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
  const [accountEmail, setAccountEmail] = useState("")
  const [contactEmail, setContactEmail] = useState("")

  const [address, setAddress] = useState("")
  const [addressLine2, setAddressLine2] = useState("")
  const [city, setCity] = useState("")
  const [state, setState] = useState("")
  const [zip, setZip] = useState("")
  const [country, setCountry] = useState("")
  const [phone, setPhone] = useState("")
  const [website, setWebsite] = useState("")
  const [businessType, setBusinessType] = useState("")

  const [closeHour, setCloseHour] = useState("12")
  const [closeMinute, setCloseMinute] = useState("00")
  const [reportToast, setReportToast] = useState(true)

  const [taxEnabled, setTaxEnabled] = useState(false)
  const [taxRate, setTaxRate] = useState("")
  const [taxName, setTaxName] = useState("Sales Tax")
  const [operations, setOperations] = useState<MerchantOperationsSettingsPayload>(defaultOperationsSettings)
  const [receiptDevices, setReceiptDevices] = useState<ReceiptDevice[]>([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [schemaReady, setSchemaReady] = useState(true)
  const [providerSummary, setProviderSummary] = useState<ProviderSummary[]>([])
  const [integrationSummary, setIntegrationSummary] = useState<IntegrationSummary>({
    wallets: 0,
    checkoutLinks: 0,
    webhookConfigured: false,
    inventoryAvailable: false,
    inventoryItems: 0
  })

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
    setSchemaReady(payload.schemaReady !== false)

    if (settings) {
      setBusinessName(settings.business_name || "")
      setContactEmail(settings.contact_email || "")
      setAddress(settings.address || "")
      setAddressLine2(settings.address_line_2 || "")
      setCity(settings.city || "")
      setState(settings.state || "")
      setZip(settings.zip || "")
      setCountry(settings.country || "")
      setPhone(settings.phone || "")
      setWebsite(settings.website || "")
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
    if (payload.operations) setOperations({ ...defaultOperationsSettings, ...payload.operations })
    setReceiptDevices(payload.receiptDevices || [])
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

      setAccountEmail(user.email ?? "")

      const payload = await callSettingsApi("GET")
      applyPayload(payload)

      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) {
        const requestOptions = {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store" as const
        }
        const [providerResponse, walletResponse, checkoutResponse, webhookResponse, inventoryResponse] = await Promise.all([
          fetch("/api/providers", requestOptions),
          fetch("/api/wallets/overview", requestOptions),
          fetch("/api/checkout-links", requestOptions),
          fetch("/api/merchant/webhooks", requestOptions),
          fetch("/api/inventory", requestOptions)
        ])
        if (providerResponse.ok) {
          const providerPayload = await providerResponse.json() as { providers?: ProviderSummary[] }
          setProviderSummary(providerPayload.providers || [])
        }
        const walletPayload = walletResponse.ok
          ? await walletResponse.json() as { wallets?: unknown[] }
          : {}
        const checkoutPayload = checkoutResponse.ok
          ? await checkoutResponse.json() as { links?: unknown[] }
          : {}
        const webhookPayload = webhookResponse.ok
          ? await webhookResponse.json() as { webhook?: unknown }
          : {}
        const inventoryPayload = inventoryResponse.ok
          ? await inventoryResponse.json() as { available?: boolean; summary?: { totalItems?: number } }
          : {}
        setIntegrationSummary({
          wallets: walletPayload.wallets?.length || 0,
          checkoutLinks: checkoutPayload.links?.length || 0,
          webhookConfigured: Boolean(webhookPayload.webhook),
          inventoryAvailable: Boolean(inventoryPayload.available),
          inventoryItems: Number(inventoryPayload.summary?.totalItems || 0)
        })
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
          contact_email: contactEmail || null,
          address: address || null,
          address_line_2: addressLine2 || null,
          city: city || null,
          state: state || null,
          zip: zip || null,
          country: country || null,
          phone: phone || null,
          website: website || null,
          business_type: businessType || null,
          closeout_time: `${closeHour}:${closeMinute}`,
          report_toast: reportToast
        },
        tax: {
          tax_enabled: taxEnabled,
          tax_rate: sanitizeTaxRate(taxRate),
          tax_name: taxName || "Sales Tax"
        },
        operations
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
  const updateOperation = <K extends keyof MerchantOperationsSettingsPayload>(
    key: K,
    value: MerchantOperationsSettingsPayload[K]
  ) => setOperations((current) => ({ ...current, [key]: value }))

  return (
    <div className="space-y-5 md:space-y-7">
      <div>
        <h1 className="text-2xl font-semibold text-gray-950 md:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-gray-600">Business, payment, POS, tax, notification, and integration preferences.</p>
      </div>

      {!schemaReady && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Settings database migration required</p>
          <p className="mt-1 leading-6">
            Apply the June 7, 2026 merchant operations settings migration before saving extended receipt, POS, notification, and profile fields.
          </p>
        </div>
      )}

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
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className={fieldClass}
              placeholder={accountEmail || "receipts@example.com"}
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
            <label className={labelClass}>Address Line 2</label>
            <input
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
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
            <IntegrationLink title="Hosted Checkout" detail="Manage checkout links and customer-facing payment options." href="/dashboard/checkout" />
          </div>
        </div>
      </DashboardSection>

      <DashboardSection title="POS Preferences" titleTone="blue">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass}>Default Terminal Label</label>
              <input
                value={operations.default_terminal_label || ""}
                onChange={(e) => updateOperation("default_terminal_label", e.target.value || null)}
                className={fieldClass}
                placeholder="Front Counter"
              />
            </div>
            <IntegrationLink title="Terminals & Device Preferences" detail="Manage terminal names, PINs, auto-lock, and drawer setup." href="/dashboard/pos" />
            <SettingToggle title="Receipt prompt after payment" detail="Ask cashiers whether to show or send a receipt." checked={operations.receipt_prompt_after_payment} onChange={(value) => updateOperation("receipt_prompt_after_payment", value)} />
            <SettingToggle title="Require cashier note" detail="Store preference only; enforcement is planned for supported POS workflows." checked={operations.require_cashier_note} onChange={(value) => updateOperation("require_cashier_note", value)} />
            <SettingToggle title="Cash drawer enabled" detail="Stores the preference. Hardware drawer control is not live from Settings." checked={operations.cash_drawer_enabled} onChange={(value) => updateOperation("cash_drawer_enabled", value)} />
            <SettingToggle title="Tipping enabled" detail="Preference is stored for future supported POS tipping." checked={operations.tipping_enabled} onChange={(value) => updateOperation("tipping_enabled", value)} />
          </div>
        </div>
      </DashboardSection>

      <DashboardSection title="Receipts" titleTone="blue">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">
          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {receiptDevices.map((device) => (
              <div key={`${device.type}-${device.provider}`} className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-950">{device.label}</p>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    device.status === "AVAILABLE" || device.status === "CONNECTED"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-700"
                  }`}>
                    {device.status.replaceAll("_", " ")}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {device.type === "BROWSER_PRINT"
                    ? "Printable HTML and PDF downloads are live."
                    : "Provider or printer configuration is required."}
                </p>
              </div>
            ))}
            {!receiptDevices.length && (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2.5">
                <p className="text-sm font-semibold text-emerald-900">Browser Print / PDF</p>
                <p className="mt-1 text-xs text-emerald-700">Available after the receipt-device migration is applied.</p>
              </div>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <SettingToggle title="Show business name" detail="Include the stored business name on generated receipts." checked={operations.show_business_name} onChange={(value) => updateOperation("show_business_name", value)} />
            <SettingToggle title="Show business address" detail="Include address fields when present." checked={operations.show_business_address} onChange={(value) => updateOperation("show_business_address", value)} />
            <SettingToggle title="Show transaction ID" detail="Include the PineTree transaction reference." checked={operations.show_transaction_id} onChange={(value) => updateOperation("show_transaction_id", value)} />
            <SettingToggle title="Show network" detail="Include the settlement network when available." checked={operations.show_network} onChange={(value) => updateOperation("show_network", value)} />
            <SettingToggle title="Show provider" detail="Include the payment provider label." checked={operations.show_provider} onChange={(value) => updateOperation("show_provider", value)} />
            <SettingToggle title="Show wallet reference" detail="Include wallet references on receipts when available." checked={operations.show_wallet_reference} onChange={(value) => updateOperation("show_wallet_reference", value)} />
            <SettingToggle title="Auto-print receipts" detail="Preference is stored; printer hardware wiring is planned." checked={operations.auto_print} onChange={(value) => updateOperation("auto_print", value)} />
            <SettingToggle title="Email receipts" detail="Preference is stored; automatic delivery is planned." checked={operations.email_receipt_enabled} onChange={(value) => updateOperation("email_receipt_enabled", value)} />
            <SettingToggle title="SMS receipts" detail="Preference is stored; automatic SMS delivery is planned." checked={operations.sms_receipt_enabled} onChange={(value) => updateOperation("sms_receipt_enabled", value)} />
            <div className="md:col-span-2">
              <label className={labelClass}>Receipt Footer</label>
              <textarea
                value={operations.receipt_footer || ""}
                onChange={(e) => updateOperation("receipt_footer", e.target.value || null)}
                className={`${fieldClass} min-h-24`}
                placeholder="Thank you for shopping with us."
              />
            </div>
          </div>
        </div>
      </DashboardSection>

      <DashboardSection title="Tax" titleTone="blue">
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

      <DashboardSection title="Notifications" titleTone="blue">
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
          </div>
          <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
            <SettingToggle title="Successful payment alerts" detail="Preference stored; notification delivery is planned." checked={operations.successful_payment_alerts} onChange={(value) => updateOperation("successful_payment_alerts", value)} />
            <SettingToggle title="Failed payment alerts" detail="Preference stored; notification delivery is planned." checked={operations.failed_payment_alerts} onChange={(value) => updateOperation("failed_payment_alerts", value)} />
            <SettingToggle title="Incomplete payment alerts" detail="Preference stored; notification delivery is planned." checked={operations.incomplete_payment_alerts} onChange={(value) => updateOperation("incomplete_payment_alerts", value)} />
            <SettingToggle title="Daily summary" detail="Preference stored; scheduled summary delivery is planned." checked={operations.daily_summary} onChange={(value) => updateOperation("daily_summary", value)} />
            <SettingToggle title="Low inventory alerts" detail="Preference stored; alert delivery is planned." checked={operations.low_inventory_alerts} onChange={(value) => updateOperation("low_inventory_alerts", value)} />
          </div>
        </div>
      </div>
      </DashboardSection>

      <DashboardSection title="Security & Integrations" titleTone="blue">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="flex min-h-36 flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-gray-950">Account Security</p>
            <p className="mt-1 flex-1 break-all text-xs leading-5 text-gray-500">
              Signed in as {accountEmail || "merchant"}. Session security is managed by Supabase Auth.
            </p>
            <button type="button" onClick={() => void signOut()} className="mt-3 w-fit text-sm font-semibold text-red-600 hover:text-red-700">
              Sign out
            </button>
          </div>
          <IntegrationLink title="Wallets" detail={`${integrationSummary.wallets} settlement wallet${integrationSummary.wallets === 1 ? "" : "s"} connected.`} href="/dashboard/wallets" label={integrationSummary.wallets ? "Connected" : "Set up"} />
          <IntegrationLink title="Checkout & Webhooks" detail={`${integrationSummary.checkoutLinks} checkout link${integrationSummary.checkoutLinks === 1 ? "" : "s"}; webhook ${integrationSummary.webhookConfigured ? "configured" : "not configured"}.`} href="/dashboard/checkout" label={integrationSummary.webhookConfigured ? "Configured" : "Open"} />
          <IntegrationLink title="Inventory" detail={integrationSummary.inventoryAvailable ? `${integrationSummary.inventoryItems} active inventory item${integrationSummary.inventoryItems === 1 ? "" : "s"}.` : "Database migration required."} href="/dashboard/inventory" label={integrationSummary.inventoryAvailable ? "Available" : "Set up"} />
          <IntegrationLink title="POS Providers" detail={`${enabledRails.length} provider${enabledRails.length === 1 ? "" : "s"} currently enabled.`} href="/dashboard/providers" />
        </div>
      </DashboardSection>

      <div className="sticky bottom-3 z-10 rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-[0_16px_40px_rgba(15,23,42,0.12)] backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
        <button
          onClick={saveSettings}
          disabled={saving || !schemaReady}
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

function SettingToggle({
  title,
  detail,
  checked,
  onChange
}: {
  title: string
  detail: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/70 p-4">
      <div>
        <p className="text-sm font-semibold text-gray-950">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-gray-500">{detail}</p>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} />
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
