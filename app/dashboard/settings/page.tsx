"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"
import {
  DashboardSection,
  dashboardPageTitleClass
} from "@/components/dashboard/DashboardPrimitives"
import Link from "next/link"
import ToggleSwitch from "@/components/ui/ToggleSwitch"

type MerchantSettingsPayload = {
  business_name: string | null
  legal_business_name?: string | null
  business_dba?: string | null
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
  owner_first_name?: string | null
  owner_last_name?: string | null
  owner_email?: string | null
  owner_phone?: string | null
  profile_status?: "incomplete" | "complete" | "needs_attention"
  completed_at?: string | null
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
  const [businessDba, setBusinessDba] = useState("")
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
  const [ownerFirstName, setOwnerFirstName] = useState("")
  const [ownerLastName, setOwnerLastName] = useState("")
  const [ownerEmail, setOwnerEmail] = useState("")
  const [ownerPhone, setOwnerPhone] = useState("")
  const [profileStatus, setProfileStatus] = useState<"incomplete" | "complete" | "needs_attention">("incomplete")

  const [closeHour, setCloseHour] = useState("12")
  const [closeMinute, setCloseMinute] = useState("00")
  const [reportToast, setReportToast] = useState(true)

  const [taxEnabled, setTaxEnabled] = useState(false)
  const [taxRate, setTaxRate] = useState("")
  const [taxName, setTaxName] = useState("Sales Tax")
  const [operations, setOperations] = useState<MerchantOperationsSettingsPayload>(defaultOperationsSettings)

  const [passkeyMsg, setPasskeyMsg] = useState("")
  const [passkeyLoading, setPasskeyLoading] = useState(false)

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
      setBusinessName(settings.legal_business_name || settings.business_name || "")
      setBusinessDba(settings.business_dba || "")
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
      setOwnerFirstName(settings.owner_first_name || "")
      setOwnerLastName(settings.owner_last_name || "")
      setOwnerEmail(settings.owner_email || "")
      setOwnerPhone(settings.owner_phone || "")
      setProfileStatus(settings.profile_status || "incomplete")
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
          ? await checkoutResponse.json() as { links?: Array<{ resolvedStatus?: string }> }
          : {}
        const webhookPayload = webhookResponse.ok
          ? await webhookResponse.json() as { webhook?: unknown }
          : {}
        const inventoryPayload = inventoryResponse.ok
          ? await inventoryResponse.json() as { available?: boolean; summary?: { totalItems?: number } }
          : {}
        setIntegrationSummary({
          wallets: walletPayload.wallets?.length || 0,
          checkoutLinks: checkoutPayload.links?.filter((link) => link.resolvedStatus !== "archived").length || 0,
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
    const parsedTaxRate = parseTaxRate(taxRate)
    if (taxEnabled && (parsedTaxRate === null || parsedTaxRate <= 0 || parsedTaxRate > 100)) {
      toast.error("Enter a valid tax rate before enabling taxes.")
      return
    }

    setSaving(true)

    try {
      const payload = await callSettingsApi("POST", {
        settings: {
          business_name: businessName || null,
          legal_business_name: businessName || null,
          business_dba: businessDba || null,
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
          business_country: country || null,
          business_state: state || null,
          business_city: city || null,
          business_address_line1: address || null,
          business_address_line2: addressLine2 || null,
          business_postal_code: zip || null,
          business_phone: phone || null,
          business_website: website || null,
          owner_first_name: ownerFirstName || null,
          owner_last_name: ownerLastName || null,
          owner_email: ownerEmail || null,
          owner_phone: ownerPhone || null,
          closeout_time: `${closeHour}:${closeMinute}`,
          report_toast: reportToast
        },
        tax: {
          tax_enabled: taxEnabled,
          tax_rate: taxEnabled ? parsedTaxRate || 0 : parsedTaxRate || 0,
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

  function parseTaxRate(raw: string): number | null {
    if (raw.trim() === "") return null
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return null
    // Clamp to [0, 100] — a rate outside this range is almost certainly a typo
    return parsed
  }

  if (loading) {
    return (
      <div className="space-y-5 md:space-y-7">
        <h1 className={dashboardPageTitleClass}>Settings</h1>
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

  async function handleAddPasskey() {
    setPasskeyMsg("")
    setPasskeyLoading(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.auth as any).registerPasskey()
      if (error) {
        setPasskeyMsg("Passkey setup was cancelled.")
      } else {
        setPasskeyMsg("Passkey added.")
      }
    } catch {
      setPasskeyMsg("Passkey setup was cancelled.")
    } finally {
      setPasskeyLoading(false)
    }
    // TODO: list and delete passkeys once Supabase SDK exposes management APIs
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
    <div className="space-y-5">
      <div>
        <h1 className={dashboardPageTitleClass}>Settings</h1>
      </div>

      {!schemaReady && (
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <p className="font-semibold text-gray-950">Some settings could not load</p>
          <p className="mt-1 leading-5">
            Saving may be limited until the settings schema is available.
          </p>
        </div>
      )}

      <DashboardSection title="Business Profile" titleTone="blue">
      <div id="business-profile" />
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        {profileStatus !== "complete" ? (
          <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50/45 px-4 py-3 text-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-blue-600 shadow-[0_0_0_4px_rgba(37,99,235,0.10)]" />
                <div>
                  <p className="font-semibold text-gray-950">Complete your Business Profile</p>
                  <p className="mt-0.5 leading-5 text-gray-600">Add your business details to activate wallets, providers, and live payments.</p>
                </div>
              </div>
              <span className="shrink-0 font-semibold text-blue-700">Complete Business Profile</span>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className={labelClass}>Legal Business Name</label>
            <input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label className={labelClass}>Business DBA</label>
            <input
              value={businessDba}
              onChange={(e) => setBusinessDba(e.target.value)}
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
            <label className={labelClass}>Business Address Line 1</label>
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

          <div>
            <label className={labelClass}>Owner First Name</label>
            <input
              value={ownerFirstName}
              onChange={(e) => setOwnerFirstName(e.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label className={labelClass}>Owner Last Name</label>
            <input
              value={ownerLastName}
              onChange={(e) => setOwnerLastName(e.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label className={labelClass}>Owner Email</label>
            <input
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              className={fieldClass}
              placeholder={accountEmail || "owner@example.com"}
            />
          </div>

          <div>
            <label className={labelClass}>Owner Phone</label>
            <input
              value={ownerPhone}
              onChange={(e) => setOwnerPhone(e.target.value)}
              className={fieldClass}
            />
          </div>
        </div>
      </div>
      </DashboardSection>

      <DashboardSection title="Receipts" titleTone="blue">
        <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-3.5">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Receipt Content</p>
              <div className="mt-1.5 grid overflow-hidden rounded-xl border border-gray-100 sm:grid-cols-2">
                <CompactSettingToggle title="Business name" checked={operations.show_business_name} onChange={(value) => updateOperation("show_business_name", value)} />
                <CompactSettingToggle title="Business address" checked={operations.show_business_address} onChange={(value) => updateOperation("show_business_address", value)} />
                <CompactSettingToggle title="Transaction ID" checked={operations.show_transaction_id} onChange={(value) => updateOperation("show_transaction_id", value)} />
                <CompactSettingToggle title="Provider" checked={operations.show_provider} onChange={(value) => updateOperation("show_provider", value)} />
                <CompactSettingToggle title="Network" checked={operations.show_network} onChange={(value) => updateOperation("show_network", value)} />
                <CompactSettingToggle title="Blockchain reference" checked={operations.show_wallet_reference} onChange={(value) => updateOperation("show_wallet_reference", value)} />
              </div>
            </div>
            <div>
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
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <div className="grid gap-3 md:grid-cols-[minmax(180px,0.75fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-end">
            <div className="flex min-h-10 items-center justify-between rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2">
              <div>
                <p className="text-sm font-semibold text-gray-950">Tax enabled</p>
                <p className="text-xs text-gray-500">Apply tax to POS sales.</p>
              </div>
              <ToggleSwitch checked={taxEnabled} onChange={setTaxEnabled} />
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

      <DashboardSection title="Reporting & Reminders" titleTone="blue">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)] md:items-end">
          <div>
            <label className={labelClass}>Business Day Closeout Time</label>
            <div className="mt-1.5 flex items-center gap-2">
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

              <span className="font-medium text-gray-900">:</span>

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
            <p className="mt-1.5 text-xs text-gray-500">Determines when merchant daily reporting resets.</p>
          </div>

            <div className="flex min-h-16 items-center justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5">
              <div>
                <p className="text-sm font-semibold text-gray-950">End-of-day reminder</p>
                <p className="text-xs text-gray-500">Show the existing report reminder.</p>
              </div>
              <ToggleSwitch checked={reportToast} onChange={setReportToast} />
            </div>
          </div>
        </div>
      </DashboardSection>

      <DashboardSection title="Passkeys" titleTone="blue">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">Passkeys</p>
              <p className="mt-0.5 text-xs text-gray-500">
                Use Face ID, Touch ID, Windows Hello, or a security key to sign in faster.
              </p>
              {passkeyMsg && (
                <p className={`mt-2 text-xs ${passkeyMsg === "Passkey added." ? "text-green-600" : "text-gray-500"}`}>
                  {passkeyMsg}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleAddPasskey}
              disabled={passkeyLoading}
              className="shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-100 disabled:opacity-60"
            >
              {passkeyLoading ? "Adding..." : "Add passkey"}
            </button>
          </div>
        </div>
      </DashboardSection>

      <DashboardSection title="Security & Integrations" titleTone="blue">
        <div className="rounded-2xl border border-gray-200 bg-white p-2.5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <div className="min-w-0 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-gray-600">Account Security</p>
                <button type="button" onClick={() => void signOut()} className="shrink-0 text-[11px] font-semibold text-red-600 hover:text-red-700">
                  Sign out
                </button>
              </div>
              <p className="mt-1 truncate text-sm font-semibold text-gray-950" title={accountEmail || "merchant"}>
                {accountEmail || "Merchant account"}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">Authenticated session</p>
            </div>
            <IntegrationSummaryLink
              title="Wallets"
              value={`${integrationSummary.wallets} connected`}
              detail="Settlement wallets"
              href="/dashboard/wallets"
            />
            <IntegrationSummaryLink
              title="Checkout & Webhooks"
              value={`${integrationSummary.checkoutLinks} link${integrationSummary.checkoutLinks === 1 ? "" : "s"}`}
              detail={`Webhook ${integrationSummary.webhookConfigured ? "configured" : "not configured"}`}
              href="/dashboard/checkout"
            />
            <IntegrationSummaryLink
              title="Inventory"
              value={integrationSummary.inventoryAvailable ? `${integrationSummary.inventoryItems} item${integrationSummary.inventoryItems === 1 ? "" : "s"}` : "Not available"}
              detail="Inventory integration"
              href="/dashboard/inventory"
            />
            <IntegrationSummaryLink
              title="Payment Rails"
              value={`${enabledRails.length} enabled`}
              detail="Provider connections"
              href="/dashboard/providers"
            />
          </div>
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

function CompactSettingToggle({
  title,
  checked,
  onChange
}: {
  title: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-gray-100 px-3 py-2.5 last:border-b-0 sm:[&:nth-child(odd)]:border-r">
      <p className="text-sm font-medium text-gray-900">{title}</p>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </div>
  )
}

function IntegrationSummaryLink({
  title,
  value,
  detail,
  href
}: {
  title: string
  value: string
  detail: string
  href: string
}) {
  return (
    <Link
      href={href}
      className="group min-w-0 rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5 transition hover:border-blue-200 hover:bg-blue-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-xs font-semibold text-gray-600">{title}</p>
        <span className="shrink-0 text-[11px] font-semibold text-blue-600 group-hover:text-blue-700">Open</span>
      </div>
      <p className="mt-1 truncate text-sm font-semibold text-gray-950">{value}</p>
      <p className="mt-0.5 truncate text-xs text-gray-500">{detail}</p>
    </Link>
  )
}
