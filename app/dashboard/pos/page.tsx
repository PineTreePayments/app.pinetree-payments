"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { Copy, Eye, EyeOff, X } from "lucide-react"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"
import Button from "@/components/ui/Button"
import { primaryActionButtonClass } from "@/components/ui/PrimaryActionButton"
import { modalCloseButtonClass } from "@/components/ui/ModalCloseButton"
import Card from "@/components/ui/Card"
import {
  DashboardHeroCard,
  dashboardCardTitleClass,
  dashboardPageTitleClass,
  dashboardSectionLabelClass
} from "@/components/dashboard/DashboardPrimitives"

type Terminal = {
  id: string
  name: string
  pin: string
  autolock: string
  merchant_id?: string
  status?: string | null
  drawer_starting_amount?: number
  created_at?: string
  tax_mode: "none" | "merchant_default" | "custom"
  tax_rate: number | null
  tax_label: string
}

type DrawerEntry = {
  id: string
  type: string
  amount: number
  running_balance: number
  sale_total?: number
  cash_tendered?: number
  change_given?: number
  actual_amount?: number
  notes?: string
  created_at: string
}

type DrawerBalance = {
  balance: number
  active?: boolean
  lastEntry: DrawerEntry | null
  log: DrawerEntry[]
}

type TerminalTaxMode = "none" | "merchant_default" | "custom"

function fmtUsd(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number.isFinite(n) ? n : 0
  )
}

function formatAutoLock(value: string) {
  if (value === "never") return "Never"
  const minutes = Number(value)
  if (!Number.isFinite(minutes) || minutes <= 0) return "Not set"
  return `${minutes} min`
}

function formatTerminalDateTime(value: string | null | undefined) {
  if (!value) return "Not recorded"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Not recorded"
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  })
}

function formatTerminalStatus(value: string | null | undefined) {
  const normalized = String(value || "active").trim().toLowerCase()
  if (!normalized) return "Active"
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function terminalStatusBadgeClass(value: string | null | undefined) {
  const normalized = String(value || "active").trim().toLowerCase()
  if (["active", "online", "ready"].includes(normalized)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700"
  }
  if (["offline", "inactive", "disabled"].includes(normalized)) {
    return "border-gray-200 bg-gray-50 text-gray-600"
  }
  return "border-blue-200 bg-blue-50 text-blue-700"
}

function formatTaxSettings(terminal: Terminal) {
  if (terminal.tax_mode === "merchant_default") return "Merchant default"
  if (terminal.tax_mode === "custom") return "Custom for this terminal"
  return "No tax"
}

function formatTaxRate(terminal: Terminal, defaultTaxRate: number | null) {
  if (terminal.tax_mode === "none") return "Not applied"
  if (terminal.tax_mode === "custom") {
    return typeof terminal.tax_rate === "number" ? `${terminal.tax_rate}%` : "Custom rate not set"
  }
  return typeof defaultTaxRate === "number" ? `${defaultTaxRate}%` : "Default rate not set"
}

function DetailRow({
  label,
  value,
  mono = false,
  onCopy,
}: {
  label: string
  value: string
  mono?: boolean
  onCopy?: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-gray-100 py-2 first:border-t-0">
      <span className="shrink-0 text-sm text-gray-500">{label}</span>
      <span className={`flex min-w-0 items-start gap-1.5 text-right text-sm font-medium text-gray-900 ${mono ? "font-mono text-xs leading-5" : ""}`}>
        <span className="min-w-0 break-all">{value}</span>
        {onCopy ? (
          <button
            type="button"
            onClick={onCopy}
            aria-label={`Copy ${label}`}
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-blue-500 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-100"
          >
            <Copy size={12} aria-hidden="true" />
          </button>
        ) : null}
      </span>
    </div>
  )
}

function ActivityMetric({
  label,
  value,
}: {
  label: string
  value: ReactNode
}) {
  return (
    <div className="min-w-0 rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-500">{label}</p>
      <div className="mt-1 text-sm font-semibold leading-5 text-gray-950">{value}</div>
    </div>
  )
}

export default function POSPage() {

  const [terminals,setTerminals] = useState<Terminal[]>([])
  const [creating,setCreating] = useState(false)

  const [name,setName] = useState("")
  const [pin,setPin] = useState("")
  const [recoveryPhrase,setRecoveryPhrase] = useState("")
  const [autoLock,setAutoLock] = useState("5")
  const [drawerStartingAmount, setDrawerStartingAmount] = useState("")
  const [taxMode, setTaxMode] = useState<TerminalTaxMode>("none")
  const [customTaxRate, setCustomTaxRate] = useState("")
  const [defaultTax, setDefaultTax] = useState<{ available: boolean; rate: number | null }>({ available: false, rate: null })

  const [drawerBalances, setDrawerBalances] = useState<Record<string, DrawerBalance>>({})
  const [closeoutTerminalId, setCloseoutTerminalId] = useState<string | null>(null)
  const [closeoutAmount, setCloseoutAmount] = useState("")
  const [closeoutResult, setCloseoutResult] = useState<{ expected: number; actual: number; discrepancy: number } | null>(null)
  const [closeoutBusy, setCloseoutBusy] = useState(false)

  const [showPin,setShowPin] = useState(false)

  const [confirmDelete,setConfirmDelete] = useState(false)
  const [terminalToDelete,setTerminalToDelete] = useState<string | null>(null)
  const [expandedTerminalId, setExpandedTerminalId] = useState<string | null>(null)

  const formRef = useRef<HTMLDivElement | null>(null)

  const callPosTerminalsApi = useCallback(async (method: "GET" | "POST" | "DELETE", body?: unknown) => {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token

    if (!token) {
      throw new Error("Please sign in again")
    }

    const res = await fetch("/api/pos/terminals", {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: method === "GET" ? undefined : JSON.stringify(body || {}),
      credentials: "include",
      cache: "no-store"
    })

      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(payload?.error || "Terminal request failed")
      }

    return payload
  }, [])

  const loadTerminals = useCallback(async () => {
    try {
      const payload = await callPosTerminalsApi("GET") as {
        terminals?: Terminal[]
        defaultTax?: { available: boolean; rate: number | null }
      }
      const list = payload.terminals || []
      setTerminals(list)
      if (payload.defaultTax) {
        setDefaultTax(payload.defaultTax)
        setTaxMode(payload.defaultTax.available ? "merchant_default" : "none")
      }
      void loadDrawerBalances(list)
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Failed to load terminals")
    }
  }, [callPosTerminalsApi])

  async function loadDrawerBalances(terminalList: Terminal[]) {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) return

    const results = await Promise.allSettled(
      terminalList.map(async (t) => {
        const res = await fetch(`/api/pos/drawer/balance?terminalId=${encodeURIComponent(t.id)}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return null
        const data = await res.json() as DrawerBalance
        return { id: t.id, data }
      })
    )
    const map: Record<string, DrawerBalance> = {}
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        map[r.value.id] = r.value.data
      }
    }
    setDrawerBalances(map)
  }

  async function submitCloseout() {
    if (!closeoutTerminalId) return
    const actual = Number(closeoutAmount)
    if (!Number.isFinite(actual) || actual < 0) {
      toast.error("Enter a valid amount")
      return
    }
    setCloseoutBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const terminal = terminals.find(t => t.id === closeoutTerminalId)
      const res = await fetch("/api/pos/drawer/closeout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        credentials: "include",
        body: JSON.stringify({ terminalId: closeoutTerminalId, merchantId: terminal?.merchant_id, actualAmount: actual })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCloseoutResult({ expected: data.expectedBalance, actual: data.actualAmount, discrepancy: data.discrepancy })
      void loadDrawerBalances(terminals)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Closeout failed")
    } finally {
      setCloseoutBusy(false)
    }
  }

  /* LOAD TERMINALS */

  useEffect(()=>{
    queueMicrotask(() => {
      void loadTerminals()
    })
  },[loadTerminals])

  /* SCROLL TO FORM */

  useEffect(()=>{
    if(creating && formRef.current){
      formRef.current.scrollIntoView({ behavior:"smooth" })
    }
  },[creating])

  useEffect(() => {
    if (!expandedTerminalId) return

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setExpandedTerminalId(null)
      }
    }

    document.addEventListener("keydown", handleEscape)

    return () => {
      document.removeEventListener("keydown", handleEscape)
    }
  }, [expandedTerminalId])

  /* CREATE TERMINAL */

  function startCreatingTerminal() {
    setCreating(true)
  }

  async function createTerminal(){
    if(!name){
      toast.error("Register name required")
      return
    }

    if(pin.length !== 4){
      toast.error("PIN must be 4 digits")
      return
    }

    if (recoveryPhrase.trim().length < 4) {
      toast.error("Recovery phrase must be at least 4 characters")
      return
    }

    const parsedCustomTaxRate = Number(customTaxRate)
    if (taxMode === "merchant_default" && !defaultTax.available) {
      toast.error("No default tax rate configured")
      return
    }
    if (taxMode === "custom" && (!Number.isFinite(parsedCustomTaxRate) || parsedCustomTaxRate <= 0 || parsedCustomTaxRate > 100)) {
      toast.error("Enter a custom tax rate greater than 0 and no more than 100")
      return
    }

    try {
      const payload = await callPosTerminalsApi("POST", {
        name,
        pin,
        recoveryPhrase,
        autolock: autoLock,
        drawer_starting_amount: drawerStartingAmount ? Number(drawerStartingAmount) : 0,
        taxMode,
        taxRate: taxMode === "custom" ? parsedCustomTaxRate : null,
        taxLabel: "Sales tax"
      }) as { terminal?: Terminal }

      if (payload.terminal) {
        setTerminals(prev => [payload.terminal as Terminal, ...prev])
      }

      setName("")
      setPin("")
      setRecoveryPhrase("")
      setAutoLock("5")
      setDrawerStartingAmount("")
      setTaxMode(defaultTax.available ? "merchant_default" : "none")
      setCustomTaxRate("")
      setCreating(false)
      toast.success("Terminal created")
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Failed to create terminal")
    }

  }

  /* DELETE TERMINAL */

  async function deleteTerminal(id:string){
    try {
      await callPosTerminalsApi("DELETE", { id })
      setTerminals(prev => prev.filter(t=>t.id !== id))
      toast.success("Terminal removed")
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Failed to delete terminal")
    }

  }

  function toggleTerminalDetails(id: string) {
    setExpandedTerminalId((prev) => (prev === id ? null : id))
  }

  const selectedTerminal = terminals.find((terminal) => terminal.id === expandedTerminalId) || null
  const selectedDrawer = selectedTerminal ? drawerBalances[selectedTerminal.id] : null
  const todayKey = new Date().toDateString()
  const selectedTodaySalesEntries = selectedDrawer?.log.filter((entry) => {
    const isToday = new Date(entry.created_at).toDateString() === todayKey
    const looksLikeSale = entry.type.toLowerCase().includes("sale") || entry.sale_total !== undefined
    return isToday && looksLikeSale
  }) || []
  const selectedTodaySalesTotal = selectedTodaySalesEntries.reduce((sum, entry) => {
    const amount = typeof entry.sale_total === "number" ? entry.sale_total : entry.amount
    return sum + (Number.isFinite(amount) ? amount : 0)
  }, 0)
  const hasTerminalActivityStats = selectedTodaySalesEntries.length > 0
  const selectedTerminalStatus = formatTerminalStatus(selectedTerminal?.status)
  const selectedDrawerShiftLabel = selectedDrawer?.active ? "Drawer shift: Open" : "Drawer shift: Closed"
  const showSelectedDrawerBalance = Boolean(selectedDrawer?.active)
  const hasSelectedActivity = hasTerminalActivityStats || showSelectedDrawerBalance

  function copyValue(label: string, value: string | null | undefined) {
    const text = String(value || "").trim()
    if (!text) return
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success(`${label} copied`))
      .catch(() => toast.error("Copy failed"))
  }

  return (

    <div className="relative space-y-4 md:space-y-6">

      {/* DELETE CONFIRM MODAL */}

      {confirmDelete && (

        <div data-pinetree-overlay="true" className="pinetree-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">

          <Card className="w-full max-w-md">

            <h2 className="text-lg font-semibold mb-2 text-gray-900">
              Remove Terminal
            </h2>

            <p className="text-sm text-gray-500 mb-6">
              Are you sure you want to remove this terminal?
            </p>

            <div className="flex justify-end gap-3">

              <Button variant="secondary" onClick={()=>setConfirmDelete(false)}>
                Cancel
              </Button>

              <Button
                variant="danger"
                onClick={()=>{
                  if(terminalToDelete){
                    deleteTerminal(terminalToDelete)
                  }
                  setConfirmDelete(false)
                }}
              >
                Remove Terminal
              </Button>

            </div>

          </Card>

        </div>

      )}

      {/* HEADER */}

      <div>

        <h1 className={dashboardPageTitleClass}>
          Point of Sale
        </h1>

      </div>

      <div className="rounded-2xl border border-blue-200/80 bg-[linear-gradient(135deg,#ffffff_0%,#f7fbff_55%,#eef5ff_100%)] px-3.5 py-3 shadow-[0_10px_30px_rgba(37,99,235,0.1)] md:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className={dashboardSectionLabelClass}>ACTIVE TERMINALS</p>
            <div className="mt-1 flex items-baseline gap-2">
              <p className="text-3xl font-semibold leading-none text-gray-950">{terminals.length}</p>
              <p className="truncate text-xs font-medium text-gray-600">Manage and launch POS sessions</p>
            </div>
          </div>
          <Button
            variant="secondary"
            className={`${primaryActionButtonClass} self-end`}
            onClick={startCreatingTerminal}
          >
            Register terminal
          </Button>
        </div>
      </div>

      <div className="hidden md:block">
        <DashboardHeroCard
          eyebrow="ACTIVE TERMINALS"
          title="Manage terminals and launch POS sessions."
          value={terminals.length}
          action={
            <Button
              variant="secondary"
              className={`${primaryActionButtonClass} self-end`}
              onClick={startCreatingTerminal}
            >
              Register terminal
            </Button>
          }
        />
      </div>

      {/* CREATE TERMINAL */}

      {creating && (

        <div ref={formRef} className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">

          <h2 className="text-lg font-semibold text-gray-900 mb-6">
            Create Terminal
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">

            <div>

              <label className="block text-sm text-gray-700 mb-2 font-medium">
                Register Name
              </label>

              <input
                value={name}
                onChange={(e)=>setName(e.target.value)}
                placeholder="Front Register"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400"
              />

            </div>

            <div>

              <label className="block text-sm text-gray-700 mb-2 font-medium">
                Recovery Phrase
              </label>

              <input
                value={recoveryPhrase}
                onChange={(e)=>setRecoveryPhrase(e.target.value)}
                placeholder="Set a terminal recovery phrase"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400"
              />

              <p className="text-xs text-gray-500 mt-1">
                Used to reset this terminal PIN if forgotten.
              </p>

            </div>

            <div>

              <label className="block text-sm text-gray-700 mb-2 font-medium">
                Terminal PIN
              </label>

              <div className="relative">

                <input
                  type={showPin ? "text" : "password"}
                  maxLength={4}
                  value={pin}
                  onChange={(e)=>setPin(e.target.value)}
                  placeholder="4 digit PIN"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-center tracking-widest text-gray-900 focus:outline-none focus:border-blue-400"
                />

                <button
                  type="button"
                  onClick={()=>setShowPin(!showPin)}
                  className="absolute right-3 top-2.5 text-gray-400"
                >
                  {showPin ? <EyeOff size={18}/> : <Eye size={18}/>}
                </button>

              </div>

            </div>

            <div>

              <label className="block text-sm text-gray-700 mb-2 font-medium">
                Auto Lock Timer
              </label>

              <select
                value={autoLock}
                onChange={(e)=>setAutoLock(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400"
              >
                <option value="1">1 minute</option>
                <option value="3">3 minutes</option>
                <option value="5">5 minutes</option>
                <option value="10">10 minutes</option>
                <option value="never">Never</option>
              </select>

            </div>

            <div>

              <label className="block text-sm text-gray-700 mb-2 font-medium">
                Starting Cash Amount <span className="text-gray-400 font-normal">(optional)</span>
              </label>

              <input
                type="number"
                min="0"
                step="0.01"
                value={drawerStartingAmount}
                onChange={(e) => setDrawerStartingAmount(e.target.value)}
                placeholder="e.g. 200.00"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400"
              />

              <p className="text-xs text-gray-500 mt-1">
                The opening drawer balance cashiers confirm at the start of each shift.
              </p>

            </div>

            <fieldset className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4 md:col-span-2">
              <legend className="px-1 text-sm font-semibold text-gray-700">Tax configuration</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {([
                  ["merchant_default", "Use default tax rate", defaultTax.available && defaultTax.rate ? `Use your merchant tax rate of ${defaultTax.rate.toFixed(2)}%.` : "No default tax rate configured."],
                  ["custom", "Custom tax rate", "Set a rate for this terminal."],
                  ["none", "No tax", "Do not add tax at this terminal."],
                ] as Array<[TerminalTaxMode, string, string]>).map(([value, label, detail]) => (
                  <label
                    key={value}
                    className={`rounded-xl border p-3 ${taxMode === value ? "border-blue-300 bg-blue-50/70" : "border-gray-200 bg-white"} ${value === "merchant_default" && !defaultTax.available ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}
                  >
                    <span className="flex items-start gap-2">
                      <input
                        type="radio"
                        name="terminal-tax-mode"
                        value={value}
                        checked={taxMode === value}
                        disabled={value === "merchant_default" && !defaultTax.available}
                        onChange={() => setTaxMode(value)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="block text-sm font-semibold text-gray-900">{label}</span>
                        <span className="mt-1 block text-xs leading-5 text-gray-500">{detail}</span>
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              {taxMode === "custom" && (
                <div className="mt-4 max-w-xs">
                  <label className="block text-sm font-medium text-gray-700" htmlFor="terminal-custom-tax-rate">
                    Tax rate (%)
                  </label>
                  <input
                    id="terminal-custom-tax-rate"
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={customTaxRate}
                    onChange={(event) => setCustomTaxRate(event.target.value)}
                    placeholder="e.g. 8.25"
                    className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-gray-900 focus:border-blue-400 focus:outline-none"
                  />
                  {(!Number.isFinite(Number(customTaxRate)) || Number(customTaxRate) <= 0 || Number(customTaxRate) > 100) && (
                    <p className="mt-1.5 text-xs text-red-600">Enter a rate greater than 0 and no more than 100.</p>
                  )}
                </div>
              )}
            </fieldset>

          </div>

          <div className="flex flex-col sm:flex-row gap-3 mt-6">

            <Button
              onClick={createTerminal}
              disabled={taxMode === "merchant_default" ? !defaultTax.available : taxMode === "custom" && (!Number.isFinite(Number(customTaxRate)) || Number(customTaxRate) <= 0 || Number(customTaxRate) > 100)}
            >
              Create Terminal
            </Button>

            <Button variant="secondary" onClick={()=>setCreating(false)}>
              Cancel
            </Button>

          </div>

        </div>

      )}

      {/* TERMINAL LIST */}

      <section className="space-y-2.5 md:space-y-3">

        <p className={dashboardSectionLabelClass}>
          Active Terminals
        </p>

        <div className="space-y-2.5 md:space-y-3">

          {terminals.length === 0 && (
            <div className="p-4 text-sm text-gray-500 sm:p-5">
              No terminals created yet.
            </div>
          )}

          <div className="grid gap-3">

            {terminals.map((t) => {
              const drawer = drawerBalances[t.id]
              return (

              <div
                key={t.id}
                className="relative flex flex-col gap-2.5 rounded-2xl border border-gray-200/80 bg-white px-3.5 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.045)] transition hover:border-blue-200 hover:shadow-[0_12px_30px_rgba(15,23,42,0.07)] sm:px-5 md:flex-row md:items-center md:justify-between md:gap-4 md:py-4"
              >

                <div className="min-w-0">

                  <div className={dashboardCardTitleClass}>
                    {t.name}
                  </div>

                  <div className="mt-0.5 truncate font-mono text-[11px] text-gray-500 md:mt-1 md:text-xs" title={t.id}>
                    {t.id}
                  </div>

                  <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.13em] text-blue-600 md:mt-2 md:text-xs">
                    ● Active
                  </div>

                </div>

                <div className="grid w-full min-w-0 grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-1.5 min-[380px]:gap-2 sm:flex sm:flex-wrap sm:items-center md:w-auto md:justify-end">

                  <Button
                    variant="secondary"
                    onClick={() => toggleTerminalDetails(t.id)}
                    className="h-10 w-full min-w-0 rounded-md px-2 text-[11px] sm:w-auto sm:px-3 sm:text-xs"
                  >
                    Details
                  </Button>

                  {drawer?.active ? (
                    <Button
                      variant="secondary"
                      onClick={() => { setCloseoutTerminalId(t.id); setCloseoutAmount(""); setCloseoutResult(null) }}
                      className="h-10 w-full min-w-0 rounded-md px-2 text-[11px] sm:w-auto sm:px-3 sm:text-xs"
                    >
                      Close Drawer
                    </Button>
                  ) : null}

                  <Link href={`/terminal?tid=${t.id}`} className="block min-w-0 sm:inline-block">
                    <Button variant="primary" className="h-10 w-full min-w-0 rounded-md px-2 text-[11px] sm:w-auto sm:px-5 sm:text-sm">
                      Launch
                    </Button>
                  </Link>

                </div>

              </div>

              )
            })}

          </div>

        </div>

      </section>

      {selectedTerminal && (
        <div
          data-pinetree-overlay="true"
          className="pinetree-modal-backdrop fixed inset-0 z-50 flex items-end justify-center px-0 sm:items-center sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setExpandedTerminalId(null)
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="terminal-details-title"
            className="flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden rounded-t-3xl border border-gray-200 bg-white shadow-2xl sm:max-h-[calc(100vh-4rem)] sm:max-w-2xl sm:rounded-3xl"
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600">Terminal Details</p>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                  <h2 id="terminal-details-title" className="min-w-0 truncate text-xl font-semibold text-gray-950">
                    {selectedTerminal.name}
                  </h2>
                  <span className={`inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[11px] font-semibold ${terminalStatusBadgeClass(selectedTerminal.status)}`}>
                    {selectedTerminalStatus}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExpandedTerminalId(null)}
                aria-label="Close terminal details"
                className={modalCloseButtonClass}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
              <section className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                <p className={dashboardSectionLabelClass}>Today&apos;s Activity</p>
                {hasSelectedActivity ? (
                  <div className={`mt-3 grid gap-2 ${showSelectedDrawerBalance ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                    <ActivityMetric
                      label="Transactions"
                      value={hasTerminalActivityStats ? selectedTodaySalesEntries.length : "No transactions yet"}
                    />
                    <ActivityMetric
                      label="Sales"
                      value={hasTerminalActivityStats ? fmtUsd(selectedTodaySalesTotal) : "No sales yet"}
                    />
                    {showSelectedDrawerBalance ? (
                      <ActivityMetric
                        label="Expected Cash Balance"
                        value={fmtUsd(selectedDrawer?.balance ?? 0)}
                      />
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-3 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2.5 text-sm leading-5 text-blue-900">
                    No activity yet. Sales and transaction totals will appear after this terminal processes its first payment.
                  </p>
                )}
              </section>

              <section className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                <p className={dashboardSectionLabelClass}>Terminal Settings</p>
                <div className="mt-3 divide-y divide-gray-100 text-sm">
                  <div className="flex justify-between gap-4 py-2 first:pt-0">
                    <span className="text-gray-500">Auto-lock after</span>
                    <span className="font-medium text-gray-900">{formatAutoLock(selectedTerminal.autolock)}</span>
                  </div>
                  <div className="flex justify-between gap-4 py-2">
                    <span className="text-gray-500">Tax settings</span>
                    <span className="text-right font-medium text-gray-900">{formatTaxSettings(selectedTerminal)}</span>
                  </div>
                  <div className="flex justify-between gap-4 py-2">
                    <span className="text-gray-500">Tax rate</span>
                    <span className="font-medium text-gray-900">{formatTaxRate(selectedTerminal, defaultTax.rate)}</span>
                  </div>
                  <div className="flex justify-between gap-4 py-2 last:pb-0">
                    <span className="text-gray-500">Drawer shift</span>
                    <span className={`font-semibold ${selectedDrawer?.active ? "text-blue-700" : "text-gray-600"}`}>
                      {selectedDrawerShiftLabel.replace("Drawer shift: ", "")}
                    </span>
                  </div>
                </div>
              </section>

              <details className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF] marker:hidden">
                  Terminal Information
                </summary>
                <div className="mt-3">
                  <DetailRow
                    label="Terminal ID"
                    value={selectedTerminal.id}
                    mono
                    onCopy={() => copyValue("Terminal ID", selectedTerminal.id)}
                  />
                  {selectedTerminal.merchant_id ? (
                    <DetailRow
                      label="Merchant ID"
                      value={selectedTerminal.merchant_id}
                      mono
                      onCopy={() => copyValue("Merchant ID", selectedTerminal.merchant_id)}
                    />
                  ) : null}
                  <DetailRow label="Created" value={formatTerminalDateTime(selectedTerminal.created_at)} />
                  <DetailRow label="Last active" value={formatTerminalDateTime(selectedDrawer?.lastEntry?.created_at)} />
                </div>
              </details>
            </div>

            <div className="shrink-0 border-t border-gray-100 bg-white px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6 sm:pb-4">
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  variant="danger"
                  onClick={() => {
                    setTerminalToDelete(selectedTerminal.id)
                    setConfirmDelete(true)
                    setExpandedTerminalId(null)
                  }}
                  className="w-full rounded-xl border-red-300 bg-red-50 px-3 text-xs sm:w-auto"
                >
                  Remove Terminal
                </Button>
                <Link href={`/terminal?tid=${selectedTerminal.id}`} className="block sm:inline-block">
                  <Button variant="primary" className="w-full rounded-xl px-5 sm:w-auto">
                    Launch Terminal
                  </Button>
                </Link>
              </div>
            </div>
          </section>
        </div>
      )}
      {/* CLOSEOUT MODAL */}

      {closeoutTerminalId && (
        <div data-pinetree-overlay="true" className="pinetree-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md space-y-4">

            <h2 className="text-lg font-semibold text-gray-900">
              Closeout — {terminals.find(t => t.id === closeoutTerminalId)?.name}
            </h2>

            {!closeoutResult ? (
              <>
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">Expected Balance</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {drawerBalances[closeoutTerminalId] ? fmtUsd(drawerBalances[closeoutTerminalId].balance) : "—"}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Actual Cash Counted
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={closeoutAmount}
                    onChange={(e) => setCloseoutAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 text-lg focus:outline-none focus:border-blue-400"
                    autoFocus
                  />
                </div>
                <div className="flex gap-3">
                  <Button
                    fullWidth
                    disabled={closeoutBusy || !closeoutAmount}
                    onClick={submitCloseout}
                  >
                    {closeoutBusy ? "Submitting…" : "Submit Closeout"}
                  </Button>
                  <Button variant="secondary" onClick={() => setCloseoutTerminalId(null)}>
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Expected</span>
                    <span className="font-semibold">{fmtUsd(closeoutResult.expected)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Counted</span>
                    <span className="font-semibold">{fmtUsd(closeoutResult.actual)}</span>
                  </div>
                  <div className={`flex justify-between font-semibold border-t border-gray-200 pt-2 ${
                    closeoutResult.discrepancy === 0 ? "text-green-600" :
                    closeoutResult.discrepancy > 0 ? "text-blue-600" : "text-red-600"
                  }`}>
                    <span>
                      {closeoutResult.discrepancy === 0 ? "Balanced" :
                       closeoutResult.discrepancy > 0 ? "Overage" : "Short"}
                    </span>
                    <span>
                      {closeoutResult.discrepancy === 0 ? "✓" : fmtUsd(Math.abs(closeoutResult.discrepancy))}
                    </span>
                  </div>
                </div>
                <Button variant="secondary" fullWidth onClick={() => setCloseoutTerminalId(null)}>
                  Done
                </Button>
              </>
            )}

          </Card>
        </div>
      )}

    </div>

  )

}
