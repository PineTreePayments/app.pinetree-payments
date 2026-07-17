"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import ToggleSwitch from "@/components/ui/ToggleSwitch"

type Reader = {
  id: string
  label: string
  deviceType: string
  status: "online" | "offline" | "busy" | "unknown"
  simulated: boolean
  isDefault: boolean
  locationId: string | null
}

type Location = {
  id: string
  displayName: string
  address: Record<string, unknown>
  status: string
}

type Settings = {
  inPersonEnabled: boolean
  manualEntryEnabled: boolean
  routingPreference: "automatic" | "terminal_first" | "tap_to_pay_first"
}

type Address = {
  line1: string
  line2: string
  city: string
  state: string
  postalCode: string
  country: string
}

const emptyAddress: Address = {
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "US"
}

async function bearer() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error("Please sign in again")
  return { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }
}

export default function StripeTerminalSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [ready, setReady] = useState(false)
  const [readinessReason, setReadinessReason] = useState("")
  const [stripeTestMode, setStripeTestMode] = useState(false)
  const [readers, setReaders] = useState<Reader[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [locationName, setLocationName] = useState("")
  const [address, setAddress] = useState<Address>(emptyAddress)
  const [registrationCode, setRegistrationCode] = useState("")
  const [readerLabel, setReaderLabel] = useState("Front Counter Reader")
  const [selectedLocationId, setSelectedLocationId] = useState("")
  const [showLocationForm, setShowLocationForm] = useState(false)
  const [showPhysicalForm, setShowPhysicalForm] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")

  const locationById = useMemo(
    () => new Map(locations.map((location) => [location.id, location])),
    [locations]
  )

  const load = useCallback(async () => {
    try {
      setError("")
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
      if (!readersResponse.ok) throw new Error(readersPayload.error || "Unable to load Stripe Card Readers")
      if (!locationsResponse.ok) throw new Error(locationsPayload.error || "Unable to load Terminal Locations")

      const nextLocations = locationsPayload.locations || []
      setSettings(settingsPayload.settings)
      setReady(settingsPayload.readiness?.ready === true)
      setReadinessReason(settingsPayload.readiness?.reason || "")
      setStripeTestMode(settingsPayload.stripeTestMode === true)
      setReaders(readersPayload.readers || [])
      setLocations(nextLocations)
      setShowLocationForm((current) => current || nextLocations.length === 0)
      setSelectedLocationId((current) =>
        nextLocations.some((location: Location) => location.id === current)
          ? current
          : nextLocations[0]?.id || ""
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load in-person settings")
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function patchSettings(next: Partial<Settings>) {
    if (!settings || !ready) return
    const previous = settings
    setSettings({ ...settings, ...next })
    setError("")
    try {
      const response = await fetch("/api/providers/stripe/card-settings", {
        method: "PATCH",
        headers: await bearer(),
        body: JSON.stringify(next)
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Unable to save card settings")
      setSettings(payload.settings)
    } catch (cause) {
      setSettings(previous)
      setError(cause instanceof Error ? cause.message : "Unable to save card settings")
    }
  }

  async function post(path: string, body: Record<string, unknown>) {
    setWorking(true)
    setError("")
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: await bearer(),
        body: JSON.stringify(body)
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Stripe Terminal request failed")
      await load()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Stripe Terminal request failed")
      return false
    } finally {
      setWorking(false)
    }
  }

  async function createLocation() {
    const created = await post("/api/providers/stripe/terminal/locations", {
      displayName: locationName,
      address
    })
    if (created) {
      setLocationName("")
      setAddress(emptyAddress)
      setShowLocationForm(false)
    }
  }

  async function registerPhysicalReader() {
    const created = await post("/api/providers/stripe/terminal/readers/register", {
      registrationCode,
      label: readerLabel,
      terminalLocationId: selectedLocationId
    })
    if (created) {
      setRegistrationCode("")
      setShowPhysicalForm(false)
    }
  }

  if (!settings) return <p className="text-sm text-gray-500">Loading in-person payment settings…</p>

  const locationFormComplete = Boolean(
    locationName.trim() && address.line1.trim() && address.city.trim() &&
    address.state.trim() && address.postalCode.trim() && /^[A-Za-z]{2}$/.test(address.country.trim())
  )

  return (
    <section className="mb-5 space-y-5 rounded-2xl border border-blue-100 bg-blue-50/40 p-4">
      <header>
        <h3 className="font-semibold text-gray-950">In-person card payments</h3>
        <p className="text-sm text-gray-600">Set up Stripe Terminal without leaving PineTree.</p>
      </header>

      <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-gray-900">Stripe onboarding and readiness</span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
            {ready ? "Ready" : "Setup required"}
          </span>
        </div>
        {!ready && <p className="mt-2 text-gray-600">{readinessReason || "Complete Stripe onboarding before setting up in-person payments."}</p>}
      </div>

      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">In-person payments {settings.inPersonEnabled ? "enabled" : "disabled"}</span>
          <ToggleSwitch disabled={!ready} checked={settings.inPersonEnabled} onChange={(value) => void patchSettings({ inPersonEnabled: value })} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">Manual entry {settings.manualEntryEnabled ? "enabled" : "disabled"}</span>
          <ToggleSwitch disabled={!ready} checked={settings.manualEntryEnabled} onChange={(value) => void patchSettings({ manualEntryEnabled: value })} />
        </div>
        <label className="block text-sm">Routing preference
          <select
            className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 disabled:bg-gray-50"
            disabled={!ready}
            value={settings.routingPreference}
            onChange={(event) => void patchSettings({ routingPreference: event.target.value as Settings["routingPreference"] })}
          >
            <option value="automatic">Automatic</option>
            <option value="terminal_first">Terminal first</option>
            <option value="tap_to_pay_first" disabled>Tap to Pay first — native app required</option>
          </select>
        </label>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-950">Terminal Locations</h4>
            <p className="text-xs text-gray-500">Locations are created on this merchant’s connected Stripe account.</p>
          </div>
          {locations.length > 0 && (
            <button type="button" className="text-sm font-semibold text-blue-700" onClick={() => setShowLocationForm((current) => !current)}>
              {showLocationForm ? "Cancel" : "Create Location"}
            </button>
          )}
        </div>

        {locations.length === 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-950">Stripe Terminal Location Required</p>
            <p className="mt-1 text-sm text-amber-900">Stripe requires a location before a card reader can be registered or simulated.</p>
          </div>
        )}

        {locations.map((location) => (
          <div key={location.id} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
            <p className="font-medium text-gray-950">{location.displayName}</p>
            <p className="text-xs capitalize text-gray-500">{location.status}</p>
          </div>
        ))}

        {showLocationForm && (
          <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
            <input aria-label="Display name" className="w-full rounded-lg border border-gray-200 p-2 text-sm" placeholder="Display name" value={locationName} onChange={(event) => setLocationName(event.target.value)} />
            <input aria-label="Address line 1" className="w-full rounded-lg border border-gray-200 p-2 text-sm" placeholder="Address line 1" value={address.line1} onChange={(event) => setAddress((current) => ({ ...current, line1: event.target.value }))} />
            <input aria-label="Address line 2, optional" className="w-full rounded-lg border border-gray-200 p-2 text-sm" placeholder="Address line 2, optional" value={address.line2} onChange={(event) => setAddress((current) => ({ ...current, line2: event.target.value }))} />
            <div className="grid grid-cols-2 gap-2">
              <input aria-label="City" className="rounded-lg border border-gray-200 p-2 text-sm" placeholder="City" value={address.city} onChange={(event) => setAddress((current) => ({ ...current, city: event.target.value }))} />
              <input aria-label="State" className="rounded-lg border border-gray-200 p-2 text-sm" placeholder="State" value={address.state} onChange={(event) => setAddress((current) => ({ ...current, state: event.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input aria-label="Postal code" className="rounded-lg border border-gray-200 p-2 text-sm" placeholder="Postal code" value={address.postalCode} onChange={(event) => setAddress((current) => ({ ...current, postalCode: event.target.value }))} />
              <input aria-label="Country" className="rounded-lg border border-gray-200 p-2 text-sm uppercase" maxLength={2} placeholder="Country" value={address.country} onChange={(event) => setAddress((current) => ({ ...current, country: event.target.value.toUpperCase() }))} />
            </div>
            <button type="button" disabled={working || !ready || !locationFormComplete} className="w-full rounded-lg bg-blue-600 p-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void createLocation()}>Create Location</button>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-gray-950">Stripe Card Readers</h4>
          <button type="button" disabled={working} className="text-sm font-semibold text-blue-700 disabled:opacity-50" onClick={() => void load()}>Refresh Readers</button>
        </div>

        {readers.length === 0 && <p className="rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-500">No Stripe Card Readers registered.</p>}
        {readers.map((reader) => (
          <div key={reader.id} className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-gray-950">{reader.label || (reader.simulated ? "Sandbox Reader" : "Stripe Card Reader")}</p>
                <p className="mt-0.5 text-xs text-gray-500">{reader.deviceType || "Unknown type"} · {reader.simulated ? "Simulated / Sandbox Reader" : "Physical reader"}</p>
                <p className="mt-0.5 text-xs text-gray-500">Location: {reader.locationId ? locationById.get(reader.locationId)?.displayName || "Unknown" : "Not assigned"}</p>
              </div>
              <span className="text-xs font-semibold capitalize text-gray-600">{reader.status}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-gray-500">{reader.isDefault ? "Default reader" : "Not default"}</span>
              {!reader.isDefault && <button type="button" disabled={working} className="text-xs font-semibold text-blue-700 disabled:opacity-50" onClick={() => void post("/api/providers/stripe/terminal/readers/default", { readerId: reader.id })}>Set Default Reader</button>}
            </div>
          </div>
        ))}

        <select aria-label="Terminal Location for reader" className="w-full rounded-lg border border-gray-200 bg-white p-2 text-sm disabled:bg-gray-50" disabled={locations.length === 0} value={selectedLocationId} onChange={(event) => setSelectedLocationId(event.target.value)}>
          {locations.length === 0 && <option value="">Create a Terminal Location first</option>}
          {locations.map((location) => <option key={location.id} value={location.id}>{location.displayName}</option>)}
        </select>

        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" disabled={working || !ready || locations.length === 0} className="rounded-lg border border-blue-200 bg-white p-2 text-sm font-semibold text-blue-700 disabled:opacity-50" onClick={() => setShowPhysicalForm((current) => !current)}>Register Physical Reader</button>
          {stripeTestMode && <button type="button" disabled={working || !ready || !selectedLocationId} className="rounded-lg border border-blue-200 bg-white p-2 text-sm font-semibold text-blue-700 disabled:opacity-50" onClick={() => void post("/api/providers/stripe/terminal/readers/simulated", { terminalLocationId: selectedLocationId })}>Create Sandbox Reader</button>}
        </div>

        {locations.length === 0 && <p className="text-xs text-amber-800">Create a Terminal Location before registering a physical reader or creating a Sandbox Reader.</p>}

        {showPhysicalForm && locations.length > 0 && (
          <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
            <input aria-label="Reader label" className="w-full rounded-lg border border-gray-200 p-2 text-sm" placeholder="Reader label" value={readerLabel} onChange={(event) => setReaderLabel(event.target.value)} />
            <input aria-label="Reader registration code" className="w-full rounded-lg border border-gray-200 p-2 text-sm" type="password" autoComplete="off" placeholder="Registration code" value={registrationCode} onChange={(event) => setRegistrationCode(event.target.value)} />
            <button type="button" disabled={working || !registrationCode.trim() || !readerLabel.trim() || !selectedLocationId} className="w-full rounded-lg bg-blue-600 p-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void registerPhysicalReader()}>Register Physical Reader</button>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-gray-950">Tap to Pay</h4>
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">Native PineTree mobile app required</span>
        </div>
        <p className="mt-2 text-sm text-gray-600">Tap to Pay on iPhone and Android requires PineTree’s future native application using the Stripe Terminal SDK.</p>
      </div>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
    </section>
  )
}
