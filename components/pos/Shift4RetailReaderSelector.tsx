"use client"

import { useCallback, useEffect, useState } from "react"

type Reader = {
  readerId: string | null
  label: string | null
  model: string | null
  maskedSerial: string | null
  locationId: string | null
  isDefault: boolean
  connectivityState: string
  readinessState: string
}

type Preparation = {
  dispatchPermitted: boolean
  blockedReason: string
  reader?: { deviceClassification?: string }
}

function headers(token: string | undefined): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {}
}

/**
 * Merchant-facing Retail device choice.
 *
 * The POS holds ONLY the PineTree reader ID. It never sees or sends a Shift4
 * terminal ID, serial number, manufacturer, environment, or credential — those
 * are resolved server-side from the signed terminal session.
 *
 * Selecting a device runs preparation, which validates the choice all the way
 * to a sendable Commerce Engine For Cloud plan and then stops at the feature
 * gate. The blocked reason is shown truthfully rather than as a ready state.
 */
export default function Shift4RetailReaderSelector({
  sessionToken,
  onReaderSelected,
}: {
  sessionToken?: string
  onReaderSelected?: (readerId: string) => void
}) {
  const [readers, setReaders] = useState<Reader[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [preparation, setPreparation] = useState<Preparation | null>(null)
  const [preparationError, setPreparationError] = useState<string | null>(null)

  const prepare = useCallback(
    (readerId: string) => {
      if (!readerId || !sessionToken) return
      setPreparation(null)
      setPreparationError(null)
      // Revalidates ownership under the signed POS session and returns the
      // plan. This is not a payment request and dispatches nothing.
      void fetch("/api/pos/shift4-retail-preparation", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers(sessionToken) },
        body: JSON.stringify({ readerId }),
        cache: "no-store",
      })
        .then(async (response) => {
          const payload = (await response.json().catch(() => null)) as
            | (Preparation & { error?: string })
            | null
          if (!response.ok) {
            setPreparationError(payload?.error || "This terminal is unavailable.")
            return
          }
          if (payload) setPreparation(payload)
        })
        .catch(() => setPreparationError("This terminal could not be prepared."))
    },
    [sessionToken]
  )

  useEffect(() => {
    if (!sessionToken) return
    let active = true
    void fetch("/api/pos/shift4-retail-readers", { headers: headers(sessionToken), cache: "no-store" })
      .then(async (response) => (response.ok ? (response.json() as Promise<{ readers?: Reader[] }>) : null))
      .then((body) => {
        if (!active) return
        const available = Array.isArray(body?.readers) ? body.readers.filter((reader) => reader.readerId) : []
        setReaders(available)
        const initial = available[0]?.readerId || ""
        setSelectedId((current) => current || initial)
        if (initial) {
          onReaderSelected?.(initial)
          prepare(initial)
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
    // `onReaderSelected` is intentionally excluded: a parent that recreates the
    // callback each render would otherwise refetch the reader list endlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken, prepare])

  if (readers.length === 0) return null

  return (
    <label className="block text-left text-xs font-medium text-gray-700">
      Shift4 Retail device
      <select
        value={selectedId}
        onChange={(event) => {
          const readerId = event.target.value
          setSelectedId(readerId)
          onReaderSelected?.(readerId)
          prepare(readerId)
        }}
        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
      >
        {readers.map((reader) => (
          <option key={reader.readerId} value={reader.readerId || ""}>
            {[
              reader.label || "Shift4 reader",
              reader.model,
              reader.maskedSerial,
              reader.locationId ? "Assigned location" : "No location",
              reader.isDefault ? "Default" : "",
              reader.connectivityState === "online" ? "Online" : "Connectivity unverified",
            ]
              .filter(Boolean)
              .join(" · ")}
          </option>
        ))}
      </select>
      <span className="mt-1 block font-normal text-gray-500">
        {preparationError
          ? preparationError
          : preparation
            ? `Terminal selected. Retail processing is blocked: ${preparation.blockedReason.toLowerCase()}.`
            : "Device availability is not verified until an operator runs the Shift4 device status check. Retail processing remains gated."}
      </span>
    </label>
  )
}
