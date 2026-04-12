"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/database/supabase"
import { toast } from "sonner"

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
      <div className="space-y-10">
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm text-gray-700">
          Loading settings...
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 md:space-y-10">
      <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>

      <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">Account</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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

      <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">Tax Configuration</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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

      <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">Reporting</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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

      <div>
        <button
          onClick={saveSettings}
          disabled={saving}
          className="w-full sm:w-auto bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  )
}
