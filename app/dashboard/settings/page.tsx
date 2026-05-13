"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"
import { DashboardSection } from "@/components/dashboard/DashboardPrimitives"

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
          tax_rate: taxRate === "" ? 0 : Number(taxRate),
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

  return (
    <div className="space-y-5 md:space-y-7">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">
          Merchant Console
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-950 md:text-3xl">Settings</h1>
      </div>

      <DashboardSection title="Account" eyebrow="Business">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm text-gray-700">Business Name</label>
            <input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
            />
          </div>

          <div>
            <label className="text-sm text-gray-700">Account Email</label>
            <input
              value={email}
              disabled
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-100 text-gray-900"
            />
          </div>

          <div>
            <label className="text-sm text-gray-700">Business Address</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
            />
          </div>

          <div>
            <label className="text-sm text-gray-700">City</label>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
            />
          </div>

          <div>
            <label className="text-sm text-gray-700">State</label>
            <input
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
            />
          </div>

          <div>
            <label className="text-sm text-gray-700">ZIP</label>
            <input
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
            />
          </div>

          <div>
            <label className="text-sm text-gray-700">Country</label>
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
            />
          </div>

          <div>
            <label className="text-sm text-gray-700">Business Phone</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
            />
          </div>

          <div>
            <label className="text-sm text-gray-700">Business Type</label>
            <select
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
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

      <DashboardSection title="Tax Configuration" eyebrow="Compliance">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={taxEnabled}
              onChange={(e) => setTaxEnabled(e.target.checked)}
            />
            <span className="text-sm text-gray-900">Enable Tax Collection</span>
          </div>

          <div>
            <label className="text-sm text-gray-700">Tax Name</label>
            <input
              value={taxName}
              onChange={(e) => setTaxName(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
            />
          </div>

          <div>
            <label className="text-sm text-gray-700">Tax Rate (%)</label>
            <input
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
              placeholder="8.25"
            />
          </div>
        </div>
      </div>
      </DashboardSection>

      <DashboardSection title="Reporting" eyebrow="Closeout">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm text-gray-700">Business Day Closeout Time</label>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <select
                value={closeHour}
                onChange={(e) => setCloseHour(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 text-gray-900 bg-white w-24"
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
                className="border border-gray-300 rounded-md px-3 py-2 text-gray-900 bg-white w-24"
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

          <div>
            <label className="text-sm text-gray-700">End-of-Day Reminder</label>
            <div className="mt-2 flex items-center gap-3">
              <input
                type="checkbox"
                checked={reportToast}
                onChange={(e) => setReportToast(e.target.checked)}
              />
              <span className="text-sm text-gray-900">Show reminder toast to print daily report</span>
            </div>
          </div>
        </div>
      </div>
      </DashboardSection>

      <div>
        <button
          onClick={saveSettings}
          disabled={saving}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-blue-600 px-6 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60 sm:w-auto"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  )
}
