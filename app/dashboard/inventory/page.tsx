"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Archive, Boxes, PackagePlus, RotateCcw, Search, X } from "lucide-react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabaseClient"
import {
  CompactMetricTile,
  DashboardSection,
  MetricGrid,
  ProviderStatusPill
} from "@/components/dashboard/DashboardPrimitives"

type InventoryItem = {
  id: string
  name: string
  sku: string | null
  category: string | null
  price: number
  cost: number | null
  quantity: number
  low_stock_threshold: number
  status: "ACTIVE" | "ARCHIVED"
  effective_status: "ACTIVE" | "LOW_STOCK" | "OUT_OF_STOCK" | "ARCHIVED"
  updated_at: string
}

type InventorySummary = {
  catalogItems: number
  activeItems: number
  totalItems: number
  lowStock: number
  outOfStock: number
  inventoryValue: number
  lastUpdatedAt: string | null
}

type InventoryMovement = {
  id: string
  item_id: string
  type: "CREATE" | "ADJUST" | "SALE" | "RETURN" | "ARCHIVE" | "RESTORE" | "IMPORT" | "SYNC"
  quantity_delta: number
  reason: string | null
  created_at: string
}

type InventoryIntegration = {
  provider: string
  label: string
  status: "PLANNED" | "AVAILABLE" | "CONNECTED" | "ERROR" | "DISABLED"
  lastSyncAt: string | null
}

type InventoryResponse = {
  available: boolean
  items: InventoryItem[]
  summary: InventorySummary
  movements: InventoryMovement[]
  integrations: InventoryIntegration[]
  error?: string
}

type ItemForm = {
  name: string
  sku: string
  category: string
  price: string
  cost: string
  quantity: string
  lowStockThreshold: string
}

type Filter = "ALL" | "ACTIVE" | "LOW" | "OUT" | "ARCHIVED"

const emptyForm: ItemForm = {
  name: "",
  sku: "",
  category: "",
  price: "",
  cost: "",
  quantity: "0",
  lowStockThreshold: "5"
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number.isFinite(value) ? value : 0)
}

function itemState(item: InventoryItem) {
  if (item.effective_status === "ARCHIVED") return { label: "Archived", tone: "slate" as const }
  if (item.effective_status === "OUT_OF_STOCK") return { label: "Out of stock", tone: "red" as const }
  if (item.effective_status === "LOW_STOCK") return { label: "Low stock", tone: "amber" as const }
  return { label: "Active", tone: "green" as const }
}

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [summary, setSummary] = useState<InventorySummary>({
    catalogItems: 0,
    activeItems: 0,
    totalItems: 0,
    lowStock: 0,
    outOfStock: 0,
    inventoryValue: 0,
    lastUpdatedAt: null
  })
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [integrations, setIntegrations] = useState<InventoryIntegration[]>([])
  const [available, setAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("ALL")
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<InventoryItem | null>(null)
  const [form, setForm] = useState<ItemForm>(emptyForm)
  const [saving, setSaving] = useState(false)

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error("Please sign in again")
    const response = await fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        ...(init?.headers || {})
      },
      cache: "no-store"
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(payload?.error || "Inventory request failed")
    return payload
  }, [])

  const loadInventory = useCallback(async () => {
    setLoading(true)
    try {
      const payload = await request("/api/inventory") as InventoryResponse
      setAvailable(payload.available)
      setItems(payload.items || [])
      setSummary(payload.summary)
      setMovements(payload.movements || [])
      setIntegrations(payload.integrations || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load inventory")
    } finally {
      setLoading(false)
    }
  }, [request])

  useEffect(() => {
    void loadInventory()
  }, [loadInventory])

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return items.filter((item) => {
      if (filter === "ACTIVE" && item.effective_status !== "ACTIVE") return false
      if (filter === "ARCHIVED" && item.effective_status !== "ARCHIVED") return false
      if (filter === "LOW" && item.effective_status !== "LOW_STOCK") return false
      if (filter === "OUT" && item.effective_status !== "OUT_OF_STOCK") return false
      if (!normalizedQuery) return true
      return [item.name, item.sku, item.category]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    })
  }, [filter, items, query])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormOpen(true)
  }

  function openEdit(item: InventoryItem) {
    setEditing(item)
    setForm({
      name: item.name,
      sku: item.sku || "",
      category: item.category || "",
      price: String(item.price),
      cost: item.cost === null ? "" : String(item.cost),
      quantity: String(item.quantity),
      lowStockThreshold: String(item.low_stock_threshold)
    })
    setFormOpen(true)
  }

  async function saveItem() {
    setSaving(true)
    try {
      const body = JSON.stringify({
        ...form,
        price: Number(form.price),
        cost: form.cost === "" ? null : Number(form.cost),
        quantity: Number(form.quantity),
        lowStockThreshold: Number(form.lowStockThreshold)
      })
      await request(editing ? `/api/inventory/${editing.id}` : "/api/inventory", {
        method: editing ? "PATCH" : "POST",
        body
      })
      setFormOpen(false)
      toast.success(editing ? "Inventory item updated" : "Inventory item added")
      await loadInventory()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save inventory item")
    } finally {
      setSaving(false)
    }
  }

  async function archiveItem(item: InventoryItem) {
    if (!window.confirm(`Archive ${item.name}? It will remain in inventory history.`)) return
    try {
      await request(`/api/inventory/${item.id}`, { method: "DELETE" })
      toast.success("Inventory item archived")
      await loadInventory()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to archive inventory item")
    }
  }

  async function restoreItem(item: InventoryItem) {
    try {
      await request(`/api/inventory/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "RESTORE" })
      })
      toast.success("Inventory item restored")
      await loadInventory()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to restore inventory item")
    }
  }

  return (
    <div className="space-y-5 md:space-y-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-950 md:text-3xl">Inventory</h1>
          <p className="mt-1 text-sm text-gray-600">Manage items, pricing, and stock alerts for PineTree POS.</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          disabled={!available}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PackagePlus size={16} />
          Add Item
        </button>
      </div>

      <MetricGrid>
        <CompactMetricTile label="Catalog Items" value={summary.catalogItems} tone="blue" detail={`${summary.activeItems} active`} />
        <CompactMetricTile label="Low Stock" value={summary.lowStock} tone={summary.lowStock ? "amber" : "default"} />
        <CompactMetricTile label="Out of Stock" value={summary.outOfStock} tone={summary.outOfStock ? "red" : "default"} />
        <CompactMetricTile label="Inventory Value" value={formatUsd(summary.inventoryValue)} detail="Cost when available, otherwise retail price" />
      </MetricGrid>

      {!available && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <p className="font-semibold">Inventory database setup required</p>
          <p className="mt-1 leading-6">
            Apply the inventory migrations dated June 7, 2026 before adding merchant inventory.
          </p>
        </div>
      )}

      <DashboardSection title="Item Catalog" titleTone="blue">
        <div className="rounded-2xl border border-gray-200/80 bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-4">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search items, SKU, or category"
                className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
              />
            </label>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {([
                ["ALL", "All"],
                ["ACTIVE", "Active"],
                ["LOW", "Low stock"],
                ["OUT", "Out of stock"],
                ["ARCHIVED", "Archived"]
              ] as Array<[Filter, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`shrink-0 rounded-full border px-3 py-2 text-xs font-semibold ${
                    filter === value
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          {loading ? (
            <div className="space-y-3 p-5">
              {[1, 2, 3].map((row) => <div key={row} className="h-14 animate-pulse rounded-xl bg-gray-100" />)}
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="flex flex-col items-center px-5 py-14 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <Boxes size={22} />
              </div>
              <h2 className="mt-4 text-base font-semibold text-gray-950">
                {items.length ? "No matching items" : "Add your first item"}
              </h2>
              <p className="mt-1 max-w-md text-sm leading-6 text-gray-500">
                {items.length
                  ? "Adjust your search or inventory status filter."
                  : "Build a manual PineTree catalog now. External POS inventory sync is not enabled yet."}
              </p>
              {!items.length && available && (
                <button type="button" onClick={openCreate} className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
                  Add Item
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="divide-y divide-gray-100 md:hidden">
                {visibleItems.map((item) => {
                  const state = itemState(item)
                  return (
                    <article key={item.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-gray-950">{item.name}</h3>
                          <p className="mt-0.5 truncate text-xs text-gray-500">{item.sku || "No SKU"} · {item.category || "Uncategorized"}</p>
                        </div>
                        <ProviderStatusPill label={state.label} tone={state.tone} />
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                        <div><p className="text-[10px] uppercase text-gray-400">Price</p><p className="font-semibold">{formatUsd(item.price)}</p></div>
                        <div><p className="text-[10px] uppercase text-gray-400">Stock</p><p className="font-semibold">{item.quantity}</p></div>
                        <div><p className="text-[10px] uppercase text-gray-400">Alert at</p><p className="font-semibold">{item.low_stock_threshold}</p></div>
                      </div>
                      <p className="mt-2 text-[11px] text-gray-500">
                        Updated {new Date(item.updated_at).toLocaleDateString()}
                      </p>
                      {item.effective_status !== "ARCHIVED" ? (
                        <div className="mt-3 flex gap-2">
                          <button onClick={() => openEdit(item)} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700">Edit</button>
                          <button onClick={() => void archiveItem(item)} className="rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600">Archive</button>
                        </div>
                      ) : (
                        <button onClick={() => void restoreItem(item)} className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700">
                          <RotateCcw size={13} /> Restore
                        </button>
                      )}
                    </article>
                  )
                })}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[850px] text-sm">
                  <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                    <tr>{["Item", "SKU", "Category", "Price", "Stock", "Low at", "Status", "Updated", ""].map((label) => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visibleItems.map((item) => {
                      const state = itemState(item)
                      return (
                        <tr key={item.id} className="hover:bg-gray-50/70">
                          <td className="px-4 py-3 font-semibold text-gray-950">{item.name}</td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-500">{item.sku || "-"}</td>
                          <td className="px-4 py-3 text-gray-600">{item.category || "-"}</td>
                          <td className="px-4 py-3 font-medium">{formatUsd(item.price)}</td>
                          <td className="px-4 py-3 font-semibold">{item.quantity}</td>
                          <td className="px-4 py-3 text-gray-600">{item.low_stock_threshold}</td>
                          <td className="px-4 py-3"><ProviderStatusPill label={state.label} tone={state.tone} /></td>
                          <td className="px-4 py-3 text-xs text-gray-500">{new Date(item.updated_at).toLocaleDateString()}</td>
                          <td className="px-4 py-3">
                            {item.effective_status !== "ARCHIVED" ? (
                              <div className="flex justify-end gap-2">
                                <button onClick={() => openEdit(item)} className="text-xs font-semibold text-blue-600 hover:text-blue-700">Edit</button>
                                <button onClick={() => void archiveItem(item)} aria-label={`Archive ${item.name}`} className="text-gray-400 hover:text-red-600"><Archive size={15} /></button>
                              </div>
                            ) : (
                              <button onClick={() => void restoreItem(item)} className="text-xs font-semibold text-blue-600 hover:text-blue-700">Restore</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </DashboardSection>

      <DashboardSection title="Connect Existing POS Inventory" titleTone="blue">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {integrations.map((integration) => (
            <div key={integration.provider} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-gray-950">{integration.label}</p>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                {integration.status === "CONNECTED"
                  ? `Last synced ${integration.lastSyncAt ? new Date(integration.lastSyncAt).toLocaleString() : "not yet"}`
                  : "Inventory sync is not currently active."}
              </p>
              <ProviderStatusPill
                label={integration.status.replace("_", " ")}
                tone={integration.status === "CONNECTED" ? "green" : integration.status === "ERROR" ? "red" : "slate"}
                className="mt-3"
              />
            </div>
          ))}
        </div>
      </DashboardSection>

      <DashboardSection title="Recent Inventory Activity" titleTone="blue">
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          {movements.length ? (
            <div className="divide-y divide-gray-100">
              {movements.slice(0, 20).map((movement) => {
                const item = items.find((candidate) => candidate.id === movement.item_id)
                return (
                  <div key={movement.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-950">{item?.name || "Inventory item"}</p>
                      <p className="mt-0.5 text-xs text-gray-500">{movement.type} · {movement.reason || "Inventory updated"}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-gray-900">
                        {movement.quantity_delta > 0 ? "+" : ""}{movement.quantity_delta}
                      </p>
                      <p className="text-[11px] text-gray-500">{new Date(movement.created_at).toLocaleString()}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="px-5 py-10 text-center text-sm text-gray-500">Inventory activity will appear after items are created or adjusted.</p>
          )}
        </div>
      </DashboardSection>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 backdrop-blur-sm sm:items-center sm:p-4">
          <div role="dialog" aria-modal="true" aria-label={editing ? "Edit inventory item" : "Add inventory item"} className="max-h-[100dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-xl sm:rounded-3xl sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-xl font-semibold text-gray-950">{editing ? "Edit Item" : "Add Item"}</h2><p className="mt-1 text-sm text-gray-500">Inventory values are stored for this merchant only.</p></div>
              <button onClick={() => setFormOpen(false)} aria-label="Close item form" className="rounded-xl p-2 text-gray-500 hover:bg-gray-100"><X size={18} /></button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Item name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="form-field" /></Field>
              <Field label="SKU"><input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="form-field" /></Field>
              <Field label="Category"><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="form-field" /></Field>
              <Field label="Price"><input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="form-field" /></Field>
              <Field label="Cost (optional)"><input type="number" min="0" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} className="form-field" /></Field>
              <Field label="Stock quantity"><input type="number" min="0" step="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="form-field" /></Field>
              <Field label="Low-stock threshold"><input type="number" min="0" step="1" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })} className="form-field" /></Field>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button onClick={() => setFormOpen(false)} disabled={saving} className="min-h-10 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700">Cancel</button>
              <button onClick={() => void saveItem()} disabled={saving} className="min-h-10 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : editing ? "Save Changes" : "Add Item"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">{label}</span>
      {children}
    </label>
  )
}
