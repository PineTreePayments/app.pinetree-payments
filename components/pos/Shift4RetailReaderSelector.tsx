"use client"

import { useEffect, useState } from "react"

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

function headers(token: string | undefined): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {}
}

/**
 * Merchant-facing Retail device choice. It has no configuration inputs and no
 * provider calls: the POS may choose only a reader returned for its signed
 * PineTree terminal session. Payment execution remains independently gated.
 */
export default function Shift4RetailReaderSelector({ sessionToken }: { sessionToken?: string }) {
  const [readers, setReaders] = useState<Reader[]>([])
  const [selectedId, setSelectedId] = useState("")

  useEffect(() => {
    if (!sessionToken) return
    let active = true
    void fetch("/api/pos/shift4-retail-readers", { headers: headers(sessionToken), cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ readers?: Reader[] }> : null)
      .then((body) => {
        if (!active) return
        const available = Array.isArray(body?.readers) ? body.readers.filter((reader) => reader.readerId) : []
        setReaders(available)
        setSelectedId((current) => current || available[0]?.readerId || "")
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [sessionToken])

  if (readers.length === 0) return null

  return <label className="block text-left text-xs font-medium text-gray-700">
    Shift4 Retail device
    <select
      value={selectedId}
      onChange={(event) => {
        const readerId = event.target.value
        setSelectedId(readerId)
        // Revalidate the choice under the signed POS terminal session. The
        // selected value is not itself a payment request or provider command.
        void fetch("/api/pos/shift4-retail-readers", {
          method: "POST",
          headers: { "content-type": "application/json", ...headers(sessionToken) },
          body: JSON.stringify({ readerId }),
          cache: "no-store",
        }).catch(() => undefined)
      }}
      className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
    >
      {readers.map((reader) => <option key={reader.readerId} value={reader.readerId || ""}>
        {[reader.label || "Shift4 reader", reader.model, reader.maskedSerial, reader.locationId ? "Assigned location" : "No location", reader.isDefault ? "Default" : "", reader.connectivityState === "online" ? "Online" : "Connectivity unverified"].filter(Boolean).join(" · ")}
      </option>)}
    </select>
    <span className="mt-1 block font-normal text-gray-500">Device availability is not verified until Shift4 provides a documented status operation. Retail processing remains gated.</span>
  </label>
}
