"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Boxes,
  ChevronRight,
  CreditCard,
  FileSpreadsheet,
  Grid2X2,
  PackagePlus,
  RefreshCw,
  Search,
  ShoppingBag,
  Sprout,
  Trash2,
  Upload,
  X
} from "lucide-react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabaseClient"
import {
  CompactMetricTile,
  DashboardSection,
  MetricGrid,
  ProviderStatusPill,
  dashboardPageTitleClass
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
  status: "AVAILABLE" | "REQUIRES_CONFIGURATION" | "CONNECTING" | "CONNECTED" | "SYNCING" | "ERROR" | "DISABLED" | "PLANNED"
  detail: string
  canConnect: boolean
  canSync: boolean
  canDisconnect: boolean
  lastSyncAt?: string | null
}

type ImportSummary = {
  created: number
  skipped: number
  errors: Array<{ row: number; message: string }>
}

type ShopifyStatus = {
  connected: boolean
  status: "connected" | "not_connected"
  shop: string | null
  connectedAt: string | null
  updatedAt: string | null
  configured: boolean
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

type Filter = "ALL" | "ACTIVE" | "LOW" | "OUT"

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

function normalizeWholeNumberInput(value: string) {
  const digits = value.replace(/\D/g, "")
  if (!digits) return ""
  return digits.replace(/^0+(?=\d)/, "")
}

function parseWholeNumber(value: string, label: string) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${label} must be a whole number of zero or more.`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} is too large.`)
  }
  return parsed
}

function itemState(item: InventoryItem) {
  if (item.effective_status === "OUT_OF_STOCK") return { label: "Out of stock", tone: "red" as const }
  if (item.effective_status === "LOW_STOCK") return { label: "Low stock", tone: "amber" as const }
  return { label: "Active", tone: "green" as const }
}

function ConnectorIcon({ provider, size = 19 }: { provider: string; size?: number }) {
  if (provider === "SHIFT4_SKYTAB") return <CreditCard size={size} />
  if (provider === "CLOVER") return <Sprout size={size} />
  if (provider === "SQUARE") return <Grid2X2 size={size} />
  if (provider === "SHOPIFY") return <ShoppingBag size={size} />
  return <FileSpreadsheet size={size} />
}

function connectorStatus(
  integration: InventoryIntegration,
  shopifyStatus: ShopifyStatus | null
) {
  if (integration.provider === "SHOPIFY" && shopifyStatus?.connected) {
    return { connected: true, label: "Connected", tone: "blue" as const }
  }
  if (
    integration.provider === "SHIFT4_SKYTAB" &&
    integration.detail.includes("payment credentials exist")
  ) {
    return { connected: false, label: "Pending", tone: "amber" as const }
  }
  if (integration.status === "CONNECTED") {
    return { connected: true, label: "Connected", tone: "blue" as const }
  }
  if (integration.status === "CONNECTING" || integration.status === "SYNCING") {
    return { connected: false, label: "Pending", tone: "amber" as const }
  }
  if (integration.status === "ERROR") {
    return { connected: false, label: "Needs attention", tone: "red" as const }
  }
  return { connected: false, label: "Not Connected", tone: "slate" as const }
}

function connectorSummary(provider: string) {
  if (provider === "SHIFT4_SKYTAB") return "Shift4 and SkyTab inventory connection."
  if (provider === "CLOVER") return "Clover merchant catalog connection."
  if (provider === "SQUARE") return "Square merchant catalog connection."
  if (provider === "SHOPIFY") return "Shopify store inventory connection."
  return "Import catalog items from a CSV file."
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
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [outOfStockOpen, setOutOfStockOpen] = useState(false)
  const [editing, setEditing] = useState<InventoryItem | null>(null)
  const [form, setForm] = useState<ItemForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [integrationBusy, setIntegrationBusy] = useState<string | null>(null)
  const [selectedIntegration, setSelectedIntegration] = useState<InventoryIntegration | null>(null)
  const [configurationMessage, setConfigurationMessage] = useState("")
  const [shopifyStatus, setShopifyStatus] = useState<ShopifyStatus | null>(null)
  const [shopifyShop, setShopifyShop] = useState("")

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error("Please sign in again")
    const isFormData = init?.body instanceof FormData
    const response = await fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(init?.headers || {})
      },
      cache: "no-store"
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(payload?.error || payload?.message || "Inventory request failed")
    return payload
  }, [])

  const loadInventory = useCallback(async () => {
    setLoading(true)
    try {
      const [payload, shopifyPayload] = await Promise.all([
        request("/api/inventory") as Promise<InventoryResponse>,
        request("/api/shopify/status").catch(() => null) as Promise<ShopifyStatus | null>
      ])
      setAvailable(payload.available)
      setItems(payload.items || [])
      setSummary(payload.summary)
      setMovements(payload.movements || [])
      setIntegrations(payload.integrations || [])
      setShopifyStatus(shopifyPayload)
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
      if (item.effective_status === "ARCHIVED") return false
      if (filter === "ACTIVE" && item.effective_status !== "ACTIVE") return false
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

  const outOfStockItems = useMemo(
    () => items.filter((item) => item.effective_status === "OUT_OF_STOCK"),
    [items]
  )

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormOpen(true)
  }

  function openEdit(item: InventoryItem) {
    setSelectedItem(null)
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
      const quantity = parseWholeNumber(form.quantity, "Stock quantity")
      const lowStockThreshold = parseWholeNumber(form.lowStockThreshold, "Low-stock threshold")
      const body = JSON.stringify({
        ...form,
        price: Number(form.price),
        cost: form.cost === "" ? null : Number(form.cost),
        quantity,
        lowStockThreshold
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

  async function deleteItem(item: InventoryItem) {
    if (!window.confirm(`Delete ${item.name}? This permanently removes it from your inventory catalog.`)) return
    try {
      await request(`/api/inventory/${item.id}`, { method: "DELETE" })
      setItems((current) => current.filter((candidate) => candidate.id !== item.id))
      setSelectedItem(null)
      toast.success("Inventory item deleted")
      await loadInventory()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete inventory item")
    }
  }

  async function uploadCsv(file: File | null) {
    if (!file) return
    setImporting(true)
    setImportSummary(null)
    try {
      const data = new FormData()
      data.append("file", file)
      const payload = await request("/api/inventory/import", {
        method: "POST",
        body: data
      }) as ImportSummary
      setImportSummary(payload)
      toast.success(`CSV import complete: ${payload.created} created, ${payload.skipped} skipped`)
      await loadInventory()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "CSV import failed")
    } finally {
      setImporting(false)
    }
  }

  async function integrationAction(provider: string, action: "connect" | "sync" | "disconnect") {
    setIntegrationBusy(`${provider}:${action}`)
    try {
      await request(`/api/inventory/integrations/${provider}/${action}`, { method: "POST" })
      toast.success(`Inventory ${action} request completed`)
      await loadInventory()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Inventory integration request failed")
    } finally {
      setIntegrationBusy(null)
    }
  }

  function openIntegration(integration: InventoryIntegration) {
    setConfigurationMessage("")
    setSelectedIntegration(integration)
  }

  async function checkConfiguration(integration: InventoryIntegration) {
    setConfigurationMessage("")
    setIntegrationBusy(`${integration.provider}:connect`)
    try {
      if (integration.provider === "SHOPIFY") {
        const status = await request("/api/shopify/status") as ShopifyStatus
        setShopifyStatus(status)
        setConfigurationMessage(
          status.connected && status.shop
            ? `${status.shop} is installed for this merchant. Inventory sync remains disabled until catalog access is available.`
            : status.configured
              ? "Shopify is configured, but no merchant store installation or token was found."
              : "Shopify app credentials are not configured for this deployment."
        )
      } else {
        const payload = await request(`/api/inventory/integrations/${integration.provider}/connect`, {
          method: "POST"
        }) as { message?: string }
        setConfigurationMessage(payload.message || "Configuration check completed.")
      }
      await loadInventory()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Configuration check failed"
      setConfigurationMessage(message)
      toast.error(message)
    } finally {
      setIntegrationBusy(null)
    }
  }

  async function connectShopify() {
    setConfigurationMessage("")
    setIntegrationBusy("SHOPIFY:connect")
    try {
      const payload = await request("/api/shopify/auth", {
        method: "POST",
        body: JSON.stringify({ shop: shopifyShop.trim() })
      }) as { authUrl?: string }
      if (!payload.authUrl) throw new Error("Could not start the Shopify connection.")
      window.location.assign(payload.authUrl)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start the Shopify connection."
      setConfigurationMessage(message)
      toast.error(message)
      setIntegrationBusy(null)
    }
  }

  return (
    <div className="space-y-5 md:space-y-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h1 className={dashboardPageTitleClass}>Inventory</h1>
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
        <CompactMetricTile
          label="Out of Stock"
          value={summary.outOfStock}
          tone={summary.outOfStock ? "red" : "default"}
          interactive
          onClick={() => setOutOfStockOpen(true)}
        />
        <CompactMetricTile label="Inventory Value" value={formatUsd(summary.inventoryValue)} />
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
        <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <div className="border-b border-gray-100 p-3 sm:p-4">
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
                  ["OUT", "Out of stock"]
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
                  : "Build a manual PineTree catalog, or connect an existing POS inventory source below."}
              </p>
              {!items.length && available && (
                <button type="button" onClick={openCreate} className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
                  Add Item
                </button>
              )}
            </div>
          ) : (
            <div className="max-h-[34rem] divide-y divide-gray-100 overflow-y-auto overscroll-contain">
              {visibleItems.map((item) => {
                const state = itemState(item)
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedItem(item)}
                    className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 text-left transition hover:bg-gray-50 focus:bg-blue-50/50 focus:outline-none sm:grid-cols-[minmax(0,1.4fr)_minmax(5rem,0.55fr)_minmax(3.5rem,0.35fr)_auto_auto] sm:gap-3 sm:px-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold leading-4 text-gray-950 sm:text-sm">{item.name}</p>
                      <p className="truncate text-[11px] leading-4 text-gray-500">
                        {item.sku || item.category || "No SKU or category"}
                      </p>
                    </div>
                    <div className="hidden sm:block">
                      <p className="text-sm font-semibold text-gray-800">{formatUsd(item.price)}</p>
                    </div>
                    <div className="hidden sm:block">
                      <p className="text-sm font-semibold text-gray-800">{item.quantity}</p>
                    </div>
                    <ProviderStatusPill label={state.label} tone={state.tone} className="hidden !min-h-6 sm:inline-flex" />
                    <div className="flex items-center gap-2">
                      <div className="text-right sm:hidden">
                        <p className="text-xs font-semibold leading-4 text-gray-900">{formatUsd(item.price)}</p>
                        <p className="text-[10px] leading-4 text-gray-500">{item.quantity} in stock</p>
                      </div>
                      <ChevronRight size={16} className="shrink-0 text-gray-400" />
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </DashboardSection>

      <DashboardSection title="Connect Existing POS Inventory" titleTone="blue">
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-5">
          {integrations.map((integration) => {
            const status = connectorStatus(integration, shopifyStatus)
            const isManual = integration.provider === "MANUAL_CSV"

            return (
              <article
                key={integration.provider}
                className="flex min-h-40 flex-col rounded-2xl border border-gray-200/80 bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)] transition hover:border-blue-200 hover:bg-blue-50/30 sm:min-h-44 sm:p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                    <ConnectorIcon provider={integration.provider} size={15} />
                  </div>
                  <ProviderStatusPill
                    label={status.label}
                    tone={status.tone}
                    className="!min-h-6 shrink-0 !px-2 !text-[10px]"
                  />
                </div>
                <h3 className="mt-3 text-sm font-semibold leading-5 text-gray-950">{integration.label}</h3>
                <p className="mt-0.5 text-[11px] leading-4 text-gray-500 sm:text-xs">{connectorSummary(integration.provider)}</p>
                <div className="mt-auto pt-3">
                  <button
                    type="button"
                    onClick={() => openIntegration(integration)}
                    className="inline-flex min-h-8 items-center justify-center gap-1.5 text-left text-[11px] font-semibold text-blue-700 hover:text-blue-800"
                  >
                    {isManual ? <Upload size={14} /> : null}
                    {isManual ? "Upload CSV" : status.connected ? "Configure" : integration.provider === "SHOPIFY" ? "Connect" : "Configure"}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
        {importSummary && (
          <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-sm text-blue-950">
            <p className="font-semibold">CSV import summary</p>
            <p className="mt-1">{importSummary.created} created, {importSummary.skipped} skipped, {importSummary.errors.length} warning/error rows.</p>
            {importSummary.errors.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs">
                {importSummary.errors.slice(0, 5).map((error) => (
                  <li key={`${error.row}-${error.message}`}>Row {error.row}: {error.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}
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

      {selectedIntegration && (
        <ConnectorSetupModal
          integration={selectedIntegration}
          shopifyStatus={shopifyStatus}
          shopifyShop={shopifyShop}
          busy={integrationBusy !== null}
          importing={importing}
          configurationMessage={configurationMessage}
          onShopifyShopChange={setShopifyShop}
          onClose={() => setSelectedIntegration(null)}
          onCheck={() => void checkConfiguration(selectedIntegration)}
          onConnectShopify={() => void connectShopify()}
          onUploadCsv={(file) => void uploadCsv(file)}
          onSync={() => void integrationAction(selectedIntegration.provider, "sync")}
          onDisconnect={() => void integrationAction(selectedIntegration.provider, "disconnect")}
        />
      )}

      {selectedItem && (
        <ItemDetailModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onEdit={() => openEdit(selectedItem)}
          onDelete={() => void deleteItem(selectedItem)}
        />
      )}

      {outOfStockOpen && (
        <OutOfStockModal
          items={outOfStockItems}
          onClose={() => setOutOfStockOpen(false)}
          onSelect={(item) => {
            setOutOfStockOpen(false)
            setSelectedItem(item)
          }}
        />
      )}

      {formOpen && (
        <div data-pinetree-overlay="true" className="pinetree-modal-backdrop fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
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
              <Field label="Stock quantity">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={form.quantity}
                  onChange={(event) => setForm({ ...form, quantity: normalizeWholeNumberInput(event.target.value) })}
                  className="form-field"
                />
              </Field>
              <Field label="Low-stock threshold">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={form.lowStockThreshold}
                  onChange={(event) => setForm({ ...form, lowStockThreshold: normalizeWholeNumberInput(event.target.value) })}
                  className="form-field"
                />
              </Field>
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

function OutOfStockModal({
  items,
  onClose,
  onSelect
}: {
  items: InventoryItem[]
  onClose: () => void
  onSelect: (item: InventoryItem) => void
}) {
  return (
    <div
      data-pinetree-overlay="true"
      className="pinetree-modal-backdrop fixed inset-0 z-50 flex items-end justify-center overflow-hidden p-0 sm:items-center sm:p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Out-of-stock inventory items"
        className="flex max-h-[calc(100dvh-env(safe-area-inset-top))] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[min(38rem,calc(100dvh-2rem))] sm:max-w-lg sm:rounded-3xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 pb-4 pt-[calc(env(safe-area-inset-top)+1.25rem)] sm:p-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-600">Inventory Status</p>
            <h2 className="mt-1 text-xl font-semibold text-gray-950">Out of Stock</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close out-of-stock items" className="rounded-xl p-2 text-gray-500 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {items.length ? (
            <div className="divide-y divide-gray-100">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item)}
                  className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-5 py-2 text-left transition hover:bg-gray-50 focus:bg-blue-50/50 focus:outline-none"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-950">{item.name}</p>
                    <p className="truncate text-xs text-gray-500">{item.sku || item.category || "No SKU or category"}</p>
                  </div>
                  <p className="text-sm font-semibold text-gray-800">{formatUsd(item.price)}</p>
                  <ChevronRight size={16} className="text-gray-400" />
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center px-6 py-14 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <Boxes size={22} />
              </div>
              <h3 className="mt-4 text-base font-semibold text-gray-950">No out-of-stock items</h3>
              <p className="mt-1 max-w-sm text-sm leading-6 text-gray-500">
                All tracked items currently have stock available.
              </p>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-gray-100 bg-white px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-4 sm:p-5">
          <button type="button" onClick={onClose} className="min-h-10 w-full rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 sm:w-auto">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function ItemDetailModal({
  item,
  onClose,
  onEdit,
  onDelete
}: {
  item: InventoryItem
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const state = itemState(item)
  const details = [
    ["SKU", item.sku || "No SKU"],
    ["Category", item.category || "Uncategorized"],
    ["Price", formatUsd(item.price)],
    ["Cost", item.cost === null ? "Not set" : formatUsd(item.cost)],
    ["Stock quantity", String(item.quantity)],
    ["Low-stock alert", String(item.low_stock_threshold)]
  ]

  return (
    <div
      data-pinetree-overlay="true"
      className="pinetree-modal-backdrop fixed inset-0 z-50 flex items-end justify-center overflow-hidden p-0 sm:items-center sm:p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${item.name} inventory details`}
        className="flex max-h-[calc(100dvh-env(safe-area-inset-top))] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[min(40rem,calc(100dvh-2rem))] sm:max-w-lg sm:rounded-3xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 pb-4 pt-[calc(env(safe-area-inset-top)+1.25rem)] sm:p-5">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-600">Inventory Item</p>
            <h2 className="mt-1 truncate text-xl font-semibold text-gray-950">{item.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close item details" className="rounded-xl p-2 text-gray-500 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Current status</p>
              <p className="mt-1 text-sm text-gray-600">Updated {new Date(item.updated_at).toLocaleString()}</p>
            </div>
            <ProviderStatusPill label={state.label} tone={state.tone} />
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-3">
            {details.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-gray-100 bg-white p-3">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
                <dd className="mt-1 break-words text-sm font-semibold text-gray-900">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-gray-100 bg-white px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-4 sm:flex-row sm:justify-between sm:p-5">
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-600 hover:bg-red-50"
          >
            <Trash2 size={15} />
            Delete
          </button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button type="button" onClick={onClose} className="min-h-10 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700">
              Close
            </button>
            <button type="button" onClick={onEdit} className="min-h-10 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">
              Edit Item
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ConnectorSetupModal({
  integration,
  shopifyStatus,
  shopifyShop,
  busy,
  importing,
  configurationMessage,
  onShopifyShopChange,
  onClose,
  onCheck,
  onConnectShopify,
  onUploadCsv,
  onSync,
  onDisconnect
}: {
  integration: InventoryIntegration
  shopifyStatus: ShopifyStatus | null
  shopifyShop: string
  busy: boolean
  importing: boolean
  configurationMessage: string
  onShopifyShopChange: (value: string) => void
  onClose: () => void
  onCheck: () => void
  onConnectShopify: () => void
  onUploadCsv: (file: File | null) => void
  onSync: () => void
  onDisconnect: () => void
}) {
  const status = connectorStatus(integration, shopifyStatus)
  const isShift4 = integration.provider === "SHIFT4_SKYTAB"
  const isShopify = integration.provider === "SHOPIFY"
  const isManual = integration.provider === "MANUAL_CSV"
  const steps = isShift4
    ? [
        "Connect Shift4 from Provider Setup if it is not already connected.",
        "Confirm PineTree has Shift4 partner catalog or inventory API access.",
        "Check configuration here. Sync remains unavailable until access is verified."
      ]
    : isShopify
      ? [
          "Enter the store's myshopify.com domain.",
          "Install and approve the PineTree app in Shopify.",
          "Return to PineTree and check configuration for this merchant."
        ]
      : isManual
        ? [
            "Choose a CSV file containing your inventory items.",
            "PineTree validates each row before creating catalog items.",
            "Review the import summary for skipped rows or corrections."
          ]
        : [
            `Create or select the PineTree ${integration.label} application.`,
            "Complete merchant OAuth and store the merchant-scoped access token.",
            "Check configuration here before inventory sync is enabled."
          ]

  return (
    <div
      data-pinetree-overlay="true"
      className="pinetree-modal-backdrop fixed inset-0 z-50 flex items-end justify-center overflow-hidden p-0 sm:items-center sm:p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${integration.label} inventory setup`}
        className="flex max-h-[calc(100dvh-env(safe-area-inset-top))] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[min(44rem,calc(100dvh-2rem))] sm:max-w-xl sm:rounded-3xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 pb-4 pt-[calc(env(safe-area-inset-top)+1.25rem)] sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <ConnectorIcon provider={integration.provider} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-600">Inventory Connector</p>
              <h2 className="truncate text-xl font-semibold text-gray-950">{integration.label}</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close connector details" className="rounded-xl p-2 text-gray-500 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Status</p>
              <ProviderStatusPill label={status.label} tone={status.tone} />
            </div>
            <p className="mt-3 text-sm leading-6 text-gray-600">
              {isShopify && shopifyStatus?.connected && shopifyStatus.shop
                ? `${shopifyStatus.shop} has an active merchant installation.`
                : integration.detail}
            </p>
          </div>

          <div className="mt-5">
            <h3 className="text-sm font-semibold text-gray-950">Required setup</h3>
            <ol className="mt-3 space-y-3">
              {steps.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm leading-5 text-gray-600">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">
                    {index + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {isShopify && !shopifyStatus?.connected && (
            <div className="mt-5">
              <label htmlFor="inventory-shopify-domain" className="text-xs font-semibold text-gray-700">
                Shopify store domain
              </label>
              <input
                id="inventory-shopify-domain"
                value={shopifyShop}
                onChange={(event) => onShopifyShopChange(event.target.value)}
                placeholder="mystore.myshopify.com"
                disabled={shopifyStatus?.configured === false}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none transition placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50"
              />
            </div>
          )}

          {isManual && (
            <div className="mt-5 rounded-2xl border border-dashed border-blue-200 bg-blue-50/50 p-5 text-center">
              <FileSpreadsheet className="mx-auto text-blue-600" size={24} />
              <p className="mt-2 text-sm font-semibold text-gray-950">Import inventory from CSV</p>
              <p className="mt-1 text-xs leading-5 text-gray-500">Existing CSV validation and import rules will be applied.</p>
              <label className="mt-4 inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white">
                <Upload size={15} />
                {importing ? "Uploading..." : "Choose CSV"}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  disabled={importing}
                  onChange={(event) => onUploadCsv(event.target.files?.[0] || null)}
                />
              </label>
            </div>
          )}

          {configurationMessage && (
            <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-xs leading-5 text-blue-950">
              {configurationMessage}
            </div>
          )}

          {!isManual && (
            <div className="mt-5 rounded-xl border border-gray-200 bg-white p-3 text-xs leading-5 text-gray-600">
              Connected status is only shown after merchant-scoped authorization exists. Inventory sync stays disabled until the connector reports that it is ready.
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-gray-100 bg-white px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-4 sm:flex-row sm:justify-end sm:p-5">
          <button type="button" onClick={onClose} className="min-h-10 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700">
            Close
          </button>
          {isShift4 && (
            <Link href="/dashboard/providers" className="inline-flex min-h-10 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700">
              Open Shift4 Provider Setup
            </Link>
          )}
          {!isManual && (
            <button
              type="button"
              onClick={isShopify && !shopifyStatus?.connected ? onConnectShopify : onCheck}
              disabled={busy || (isShopify && !shopifyStatus?.connected && (!shopifyShop.trim() || shopifyStatus?.configured === false))}
              className="min-h-10 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy
                ? "Checking..."
                : isShopify && !shopifyStatus?.connected
                  ? "Connect Shopify Store"
                  : "Check Configuration"}
            </button>
          )}
          {isShopify && !shopifyStatus?.connected && (
            <button
              type="button"
              onClick={onCheck}
              disabled={busy}
              className="min-h-10 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 disabled:opacity-50"
            >
              Check Configuration
            </button>
          )}
          {status.connected && integration.canSync && (
            <button
              type="button"
              onClick={onSync}
              disabled={busy}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 disabled:opacity-50"
            >
              <RefreshCw size={14} />
              Sync now
            </button>
          )}
          {status.connected && integration.canDisconnect && (
            <button
              type="button"
              onClick={onDisconnect}
              disabled={busy}
              className="min-h-10 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-600 disabled:opacity-50"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
