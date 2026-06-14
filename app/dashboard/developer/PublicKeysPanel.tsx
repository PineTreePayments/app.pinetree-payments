"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { DashboardSection } from "@/components/dashboard/DashboardPrimitives"
import Button from "@/components/ui/Button"
import { supabase } from "@/lib/supabaseClient"

type PublicKey = {
  id: string
  name: string | null
  prefix: string
  lastUsedAt: string | null
  createdAt: string
}

type CreatedPublicKey = PublicKey & {
  key: string
}

function formatDate(value: string | null) {
  if (!value) return "Never"
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export default function PublicKeysPanel() {
  const [keys, setKeys] = useState<PublicKey[]>([])
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [revealedKey, setRevealedKey] = useState<CreatedPublicKey | null>(null)

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? ""
  }, [])

  const loadKeys = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const response = await fetch("/api/merchant/public-keys", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      const payload = (await response.json()) as { keys?: PublicKey[]; error?: string }
      if (!response.ok) throw new Error(payload.error || "Failed to load public keys")
      setKeys(payload.keys ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load public keys")
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => {
    void loadKeys()
  }, [loadKeys])

  async function createKey(event: React.FormEvent) {
    event.preventDefault()
    setCreating(true)
    try {
      const token = await getToken()
      const response = await fetch("/api/merchant/public-keys", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: name.trim() || undefined }),
      })
      const payload = (await response.json()) as { key?: CreatedPublicKey; error?: string }
      if (!response.ok || !payload.key) {
        throw new Error(payload.error || "Failed to create public key")
      }
      setRevealedKey(payload.key)
      setKeys((current) => [payload.key!, ...current])
      setName("")
      toast.success("Public browser key created")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create public key")
    } finally {
      setCreating(false)
    }
  }

  async function revokeKey(id: string) {
    setRevokingId(id)
    try {
      const token = await getToken()
      const response = await fetch(`/api/merchant/public-keys/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string }
        throw new Error(payload.error || "Failed to revoke public key")
      }
      setKeys((current) => current.filter((key) => key.id !== id))
      if (revealedKey?.id === id) setRevealedKey(null)
      toast.success("Public browser key revoked")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to revoke public key")
    } finally {
      setRevokingId(null)
    }
  }

  async function copyKey() {
    if (!revealedKey) return
    await navigator.clipboard.writeText(revealedKey.key)
    toast.success("Public key copied")
  }

  return (
    <DashboardSection title="Public Browser Keys" titleTone="blue">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-5">
          <h3 className="text-sm font-semibold text-gray-950">Browser-safe keys</h3>
          <p className="mt-1 text-xs text-gray-500">
            Use <code className="font-mono">pk_live_*</code> on websites, checkout buttons, or React apps.
            These keys can start customer checkout sessions but cannot access private account data.
          </p>
        </div>

        <form onSubmit={createKey} className="flex flex-col gap-3 sm:flex-row">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Key name, e.g. Storefront"
            className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#0052FF] focus:ring-2 focus:ring-[#0052FF]/10"
          />
          <Button type="submit" disabled={creating}>
            {creating ? "Creating..." : "Create Public Key"}
          </Button>
        </form>

        {revealedKey && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs font-semibold text-emerald-800">Copy this key now. It will not be shown again.</p>
            <div className="mt-2 flex gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-white px-3 py-2 text-xs text-gray-900">
                {revealedKey.key}
              </code>
              <button type="button" onClick={() => void copyKey()} className="rounded-lg border border-emerald-200 bg-white px-3 text-xs font-semibold text-emerald-700">
                Copy
              </button>
            </div>
          </div>
        )}

        <div className="mt-5 overflow-x-auto">
          {loading ? (
            <p className="py-4 text-center text-xs text-gray-400">Loading public keys...</p>
          ) : keys.length === 0 ? (
            <p className="py-4 text-center text-xs text-gray-400">No public browser keys yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Prefix</th>
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2 pr-4">Last Used</th>
                  <th className="py-2 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {keys.map((key) => (
                  <tr key={key.id}>
                    <td className="py-3 pr-4 font-medium text-gray-900">{key.name || "Unnamed"}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-gray-600">{key.prefix}...</td>
                    <td className="py-3 pr-4 text-xs text-gray-500">{formatDate(key.createdAt)}</td>
                    <td className="py-3 pr-4 text-xs text-gray-500">{formatDate(key.lastUsedAt)}</td>
                    <td className="py-3 text-right">
                      <button
                        type="button"
                        disabled={revokingId === key.id}
                        onClick={() => void revokeKey(key.id)}
                        className="rounded-lg border border-red-200 px-2.5 py-1 text-[11px] font-semibold text-red-600 disabled:opacity-50"
                      >
                        {revokingId === key.id ? "Revoking..." : "Revoke"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </DashboardSection>
  )
}
