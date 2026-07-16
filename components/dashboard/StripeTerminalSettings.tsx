"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import ToggleSwitch from "@/components/ui/ToggleSwitch"

type Reader = { id: string; label: string; status: string; simulated: boolean; isDefault: boolean }
type Location = { id: string; displayName: string; status: string }
type Settings = { inPersonEnabled: boolean; manualEntryEnabled: boolean; routingPreference: "automatic" | "terminal_first" | "tap_to_pay_first" }

async function bearer() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error("Please sign in again")
  return { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }
}

export default function StripeTerminalSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [readers, setReaders] = useState<Reader[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [locationName, setLocationName] = useState("")
  const [address, setAddress] = useState({ line1: "", city: "", state: "", postalCode: "", country: "US" })
  const [registrationCode, setRegistrationCode] = useState("")
  const [selectedLocationId, setSelectedLocationId] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    try {
      const headers = await bearer()
      const [settingsResponse, readersResponse, locationsResponse] = await Promise.all([
        fetch("/api/providers/stripe/card-settings", { headers, cache: "no-store" }),
        fetch("/api/providers/stripe/terminal/readers", { headers, cache: "no-store" }),
        fetch("/api/providers/stripe/terminal/locations", { headers, cache: "no-store" })
      ])
      const settingsPayload = await settingsResponse.json()
      const readersPayload = await readersResponse.json()
      const locationsPayload = await locationsResponse.json()
      if (!settingsResponse.ok) throw new Error(settingsPayload.error || "Unable to load card settings")
      setSettings(settingsPayload.settings)
      if (readersResponse.ok) setReaders(readersPayload.readers || [])
      if (locationsResponse.ok) {
        setLocations(locationsPayload.locations || [])
        setSelectedLocationId((current) => current || locationsPayload.locations?.[0]?.id || "")
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load in-person settings") }
  }, [])

  useEffect(() => { void load() }, [load])

  async function patch(next: Partial<Settings>) {
    if (!settings) return
    const optimistic = { ...settings, ...next }
    setSettings(optimistic)
    try {
      const response = await fetch("/api/providers/stripe/card-settings", { method: "PATCH", headers: await bearer(), body: JSON.stringify(next) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Unable to save card settings")
      setSettings(payload.settings)
    } catch (cause) { setSettings(settings); setError(cause instanceof Error ? cause.message : "Unable to save card settings") }
  }

  async function post(path: string, body: Record<string, unknown>) {
    setWorking(true); setError("")
    try {
      const response = await fetch(path, { method: "POST", headers: await bearer(), body: JSON.stringify(body) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Stripe Terminal request failed")
      setRegistrationCode("")
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Stripe Terminal request failed") }
    finally { setWorking(false) }
  }

  if (!settings) return <p className="text-sm text-gray-500">Loading in-person payment settings…</p>

  return (
    <section className="space-y-4 rounded-2xl border border-blue-100 bg-blue-50/40 p-4">
      <div>
        <h3 className="font-semibold text-gray-950">In-person payments</h3>
        <p className="text-sm text-gray-600">Manage Stripe Terminal readers and card fallback behavior.</p>
      </div>
      <div className="flex items-center justify-between"><span className="text-sm">Enable in-person card payments</span><ToggleSwitch checked={settings.inPersonEnabled} onChange={(value) => void patch({ inPersonEnabled: value })} /></div>
      <div className="flex items-center justify-between"><span className="text-sm">Allow manual card entry (card-not-present)</span><ToggleSwitch checked={settings.manualEntryEnabled} onChange={(value) => void patch({ manualEntryEnabled: value })} /></div>
      <label className="block text-sm">Routing preference
        <select className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2" value={settings.routingPreference} onChange={(event) => void patch({ routingPreference: event.target.value as Settings["routingPreference"] })}>
          <option value="automatic">Automatic</option><option value="terminal_first">Terminal first</option><option value="tap_to_pay_first">Tap to Pay first</option>
        </select>
      </label>
      <div className="space-y-2">
        <p className="text-sm font-medium">Locations</p>
        {locations.map(location => <div key={location.id} className="rounded-lg bg-white px-3 py-2 text-sm">{location.displayName}</div>)}
        <div className="flex gap-2">
          <input className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white p-2 text-sm" placeholder="Location name" value={locationName} onChange={event => setLocationName(event.target.value)} />
        </div>
        <input className="w-full rounded-lg border border-gray-200 bg-white p-2 text-sm" placeholder="Street address" value={address.line1} onChange={event => setAddress(current => ({ ...current, line1: event.target.value }))} />
        <div className="grid grid-cols-2 gap-2"><input className="rounded-lg border border-gray-200 bg-white p-2 text-sm" placeholder="City" value={address.city} onChange={event => setAddress(current => ({ ...current, city: event.target.value }))} /><input className="rounded-lg border border-gray-200 bg-white p-2 text-sm" placeholder="State / region" value={address.state} onChange={event => setAddress(current => ({ ...current, state: event.target.value }))} /></div>
        <div className="grid grid-cols-2 gap-2"><input className="rounded-lg border border-gray-200 bg-white p-2 text-sm" placeholder="Postal code" value={address.postalCode} onChange={event => setAddress(current => ({ ...current, postalCode: event.target.value }))} /><input className="rounded-lg border border-gray-200 bg-white p-2 text-sm uppercase" maxLength={2} placeholder="Country" value={address.country} onChange={event => setAddress(current => ({ ...current, country: event.target.value.toUpperCase() }))} /></div>
        <button disabled={working || !locationName.trim() || Object.values(address).some(value => !value.trim())} className="w-full rounded-lg bg-blue-600 p-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void post("/api/providers/stripe/terminal/locations", { displayName: locationName, address }).then(() => { setLocationName(""); setAddress({ line1: "", city: "", state: "", postalCode: "", country: "US" }) })}>Add Terminal location</button>
        <p className="text-sm font-medium">Readers</p>
        {readers.length ? readers.map(reader => <div key={reader.id} className="flex justify-between rounded-lg bg-white px-3 py-2 text-sm"><span>{reader.label || "Stripe reader"}{reader.simulated ? " (simulated)" : ""}</span><span className="text-gray-500">{reader.status}{reader.isDefault ? " · default" : ""}</span></div>) : <p className="text-sm text-gray-500">No readers registered.</p>}
        <select className="w-full rounded-lg border border-gray-200 bg-white p-2 text-sm" value={selectedLocationId} onChange={event => setSelectedLocationId(event.target.value)}>{locations.map(location => <option key={location.id} value={location.id}>{location.displayName}</option>)}</select>
        <div className="flex gap-2"><input className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white p-2 text-sm" type="password" autoComplete="off" placeholder="Reader registration code" value={registrationCode} onChange={event => setRegistrationCode(event.target.value)} /><button disabled={working || !registrationCode.trim() || !selectedLocationId} className="rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void post("/api/providers/stripe/terminal/readers/register", { registrationCode, terminalLocationId: selectedLocationId })}>Register</button></div>
        <button disabled={working} className="w-full rounded-lg border border-blue-200 bg-white p-2 text-sm font-semibold text-blue-700 disabled:opacity-50" onClick={() => void post("/api/providers/stripe/terminal/readers/simulated", { terminalLocationId: selectedLocationId || undefined })}>Create test-mode simulated reader</button>
      </div>
      <p className="text-xs text-gray-500">Tap to Pay requires the future PineTree native mobile app. It is not available in the browser.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  )
}
