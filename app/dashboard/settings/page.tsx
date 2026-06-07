"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"
import { DashboardSection } from "@/components/dashboard/DashboardPrimitives"
import ToggleSwitch from "@/components/ui/ToggleSwitch"
import {
  LoadingSkeleton,
  PageHeader,
  Surface
} from "@/components/ui/DesignSystem"

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

function parseCloseoutTime(value: string) {
  const normalized = value.trim()
  const [hour24, minute = "00"] = normalized.split(":")
  const hourNum = Number(hour24)

  return {
    hour: String(Number.isFinite(hourNum) ? hourNum : 12).padStart(2, "0"),
    minute: minute.padStart(2, "0")
  }
}

const fieldClass = "form-field mt-1.5"
const labelClass = "text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500"

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
        <PageHeader title="Settings" description="Manage merchant profile, tax, and reporting preferences." />
        <LoadingSkeleton rows={5} />
      </div>
    )
  }

  return (
    <div className="space-y-5 md:space-y-7">
      <PageHeader
        title="Settings"
        description="Manage merchant profile, tax, and reporting preferences."
      />

      <DashboardSection title="Account" titleTone="blue">
      <Surface>

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
            <label className={labelClass}>Account Email</label>
            <input
              value={email}
              disabled
              className={`${fieldClass} cursor-not-allowed bg-slate-100 text-slate-500`}
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
      </Surface>
      </DashboardSection>

      <DashboardSection title="Tax Configuration" titleTone="blue">
      <Surface>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-4 md:col-span-2">
            <div>
              <p className="text-sm font-semibold text-slate-950">Enable Tax Collection</p>
              <p className="mt-0.5 text-xs text-slate-500">Apply the configured tax rate to supported sales.</p>
            </div>
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
      </Surface>
      </DashboardSection>

      <DashboardSection title="Reporting" titleTone="blue">
      <Surface>

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

          <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
            <div>
              <p className="text-sm font-semibold text-slate-950">End-of-Day Reminder</p>
              <p className="mt-0.5 text-xs leading-5 text-slate-500">Show a reminder to print the daily report.</p>
            </div>
              <ToggleSwitch
                checked={reportToast}
                onChange={setReportToast}
              />
          </div>
        </div>
      </Surface>
      </DashboardSection>

      <div>
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
