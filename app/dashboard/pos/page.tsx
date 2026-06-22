"use client"

import Link from "next/link"
import { useState, useEffect, useRef, useCallback } from "react"
import { Eye, EyeOff } from "lucide-react"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"
import Button from "@/components/ui/Button"
import Card from "@/components/ui/Card"
import {
  DashboardHeroCard,
  dashboardCardTitleClass,
  dashboardMetricValueClass,
  dashboardPageTitleClass,
  dashboardSectionLabelClass
} from "@/components/dashboard/DashboardPrimitives"

type Terminal = {
  id: string
  name: string
  pin: string
  autolock: string
  merchant_id?: string
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
  if (!Number.isFinite(minutes) || minutes <= 0) return "-"
  return `${minutes} min`
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
      if (payload.defaultTax) setDefaultTax(payload.defaultTax)
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
      setTaxMode("none")
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
      toast.success("Terminal deleted")
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

  return (

    <div className="relative space-y-4 md:space-y-6">

      {/* DELETE CONFIRM MODAL */}

      {confirmDelete && (

        <div data-pinetree-overlay="true" className="pinetree-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">

          <Card className="w-full max-w-md">

            <h2 className="text-lg font-semibold mb-2 text-gray-900">
              Delete Terminal
            </h2>

            <p className="text-sm text-gray-500 mb-6">
              Are you sure you want to delete this terminal?
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
                Delete Terminal
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

      <DashboardHeroCard
        eyebrow="ACTIVE TERMINALS"
        title="Manage terminals and launch POS sessions."
        value={terminals.length}
        action={
          <button
            onClick={startCreatingTerminal}
            style={{ boxShadow: "0 10px 24px rgba(0,82,255,0.18)" }}
            className="inline-flex shrink-0 self-end items-center gap-1.5 rounded-full bg-[#1652f0] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.98]"
          >
            + New Terminal
          </button>
        }
      />

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
                  ["none", "No tax", "Do not add tax at this terminal."],
                  ["merchant_default", "Use default tax rate", defaultTax.available && defaultTax.rate ? `${defaultTax.rate}% merchant default` : "No default tax rate configured."],
                  ["custom", "Custom tax rate", "Set a rate for this terminal."],
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

      <section className="space-y-3">

        <p className={dashboardSectionLabelClass}>
          Active Terminals
        </p>

        <div className="space-y-3">

          {terminals.length === 0 && (
            <div className="p-4 text-sm text-gray-500 sm:p-5">
              No terminals created yet.
            </div>
          )}

          <div className="grid gap-3">

            {terminals.map((t)=>(

              <div
                key={t.id}
                className="relative flex flex-col gap-4 rounded-2xl border border-gray-200/80 bg-white px-4 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.045)] transition hover:border-blue-200 hover:shadow-[0_12px_30px_rgba(15,23,42,0.07)] sm:px-5 md:flex-row md:items-center md:justify-between"
              >

                <div className="min-w-0">

                  <div className={dashboardCardTitleClass}>
                    {t.name}
                  </div>

                  <div className="mt-1 truncate font-mono text-xs text-gray-500" title={t.id}>
                    {t.id}
                  </div>

                  <div className="mt-2 text-xs font-semibold uppercase tracking-[0.13em] text-blue-600">
                    ● Active
                  </div>

                </div>

                <div className="grid grid-cols-3 gap-2 sm:flex sm:items-center md:justify-end">

                  <Button
                    variant="secondary"
                    onClick={() => toggleTerminalDetails(t.id)}
                    className="w-full rounded-xl px-3 text-xs sm:w-auto"
                  >
                    Details
                  </Button>

                  <Link href={`/terminal?tid=${t.id}`} className="block sm:inline-block">
                    <Button variant="primary" className="w-full rounded-xl px-5 sm:w-auto">
                      Launch
                    </Button>
                  </Link>

                  <Button
                    variant="danger"
                    onClick={()=>{
                      setTerminalToDelete(t.id)
                      setConfirmDelete(true)
                    }}
                    className="w-full rounded-xl px-3 text-xs sm:w-auto"
                  >
                    Delete
                  </Button>

                </div>

              </div>

            ))}

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
                <h2 id="terminal-details-title" className="mt-1 truncate text-xl font-semibold text-gray-950">
                  {selectedTerminal.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setExpandedTerminalId(null)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Status</p>
                  <p className="mt-1 text-sm font-semibold text-blue-700">Active</p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Terminal ID</p>
                  <p className="mt-1 truncate font-mono text-xs text-gray-700" title={selectedTerminal.id}>
                    {selectedTerminal.id}
                  </p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Created</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">
                    {selectedTerminal.created_at ? new Date(selectedTerminal.created_at).toLocaleString() : "-"}
                  </p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Last Active</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">
                    {selectedDrawer?.lastEntry ? new Date(selectedDrawer.lastEntry.created_at).toLocaleString() : "-"}
                  </p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Drawer Status</p>
                  <p className={`mt-1 text-sm font-semibold ${selectedDrawer?.active ? "text-blue-700" : "text-gray-500"}`}>
                    {selectedDrawer?.active ? "Open drawer shift" : "No active drawer shift"}
                  </p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Current Drawer Balance</p>
                  <p className="mt-1 text-sm font-semibold text-gray-950">
                    {selectedDrawer ? fmtUsd(selectedDrawer.balance) : "-"}
                  </p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Today Transactions</p>
                  <p className="mt-1 text-sm font-semibold text-gray-950">
                    {hasTerminalActivityStats ? selectedTodaySalesEntries.length : "-"}
                  </p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Today Sales</p>
                  <p className="mt-1 text-sm font-semibold text-gray-950">
                    {hasTerminalActivityStats ? fmtUsd(selectedTodaySalesTotal) : "-"}
                  </p>
                </div>
              </div>

              {!hasTerminalActivityStats && (
                <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-blue-900">
                  Terminal activity will appear here after this terminal processes payments.
                </div>
              )}

              <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-3 text-sm text-gray-600">
                <div className="flex justify-between gap-4 py-1">
                  <span className="text-gray-500">Auto-lock</span>
                  <span className="font-medium text-gray-900">{formatAutoLock(selectedTerminal.autolock)}</span>
                </div>
                <div className="flex justify-between gap-4 py-1">
                  <span className="text-gray-500">Merchant</span>
                  <span className="truncate font-medium text-gray-900">{selectedTerminal.merchant_id || "-"}</span>
                </div>
                <div className="flex justify-between gap-4 border-t border-gray-100 py-1 pt-2">
                  <span className="text-gray-500">Tax mode</span>
                  <span className="font-medium text-gray-900">
                    {selectedTerminal.tax_mode === "merchant_default"
                      ? "Merchant default"
                      : selectedTerminal.tax_mode === "custom"
                        ? "Custom"
                        : "No tax"}
                  </span>
                </div>
                {selectedTerminal.tax_mode !== "none" && (
                  <div className="flex justify-between gap-4 py-1">
                    <span className="text-gray-500">Tax rate</span>
                    <span className="font-medium text-gray-900">
                      {selectedTerminal.tax_mode === "custom"
                        ? `${selectedTerminal.tax_rate}%`
                        : defaultTax.rate
                          ? `${defaultTax.rate}%`
                          : "Default rate"}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="grid shrink-0 grid-cols-3 gap-2 border-t border-gray-100 bg-white px-5 py-4 sm:flex sm:justify-end sm:px-6">
              <Link href={`/terminal?tid=${selectedTerminal.id}`} className="block sm:inline-block">
                <Button variant="primary" className="w-full rounded-xl px-5 sm:w-auto">
                  Launch
                </Button>
              </Link>
              <Button
                variant="danger"
                onClick={() => {
                  setTerminalToDelete(selectedTerminal.id)
                  setConfirmDelete(true)
                  setExpandedTerminalId(null)
                }}
                className="w-full rounded-xl px-3 text-xs sm:w-auto"
              >
                Delete
              </Button>
              <Button
                variant="secondary"
                onClick={() => setExpandedTerminalId(null)}
                className="w-full rounded-xl px-3 text-xs sm:w-auto"
              >
                Close
              </Button>
            </div>
          </section>
        </div>
      )}

      {/* DRAWER BALANCES */}

      {terminals.length > 0 && (

        <section className="space-y-3">

          <p className={dashboardSectionLabelClass}>
            Drawer Balances
          </p>

          <div className="space-y-2">

            <div className="hidden grid-cols-[minmax(0,1fr)_150px_140px] rounded-xl border border-blue-100 bg-blue-50/80 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500 sm:grid">
              <span>Terminal / drawer status</span>
              <span className="text-right">Expected balance</span>
              <span className="text-right">Action</span>
            </div>

            <div className="grid gap-2">
              {terminals.map((t) => {
                const drawer = drawerBalances[t.id]
                const balance = drawer?.balance ?? null
                const lastEntry = drawer?.lastEntry
                return (
                  <div key={t.id} className="grid gap-3 rounded-2xl border border-gray-200/80 bg-white px-4 py-3.5 shadow-[0_8px_24px_rgba(15,23,42,0.045)] transition hover:border-blue-200 hover:shadow-[0_12px_30px_rgba(15,23,42,0.07)] sm:grid-cols-[minmax(0,1fr)_150px_140px] sm:items-center sm:px-5">
                    <div className="min-w-0">
                      <p className={dashboardCardTitleClass}>{t.name}</p>
                      {lastEntry ? (
                        <p className="text-xs text-gray-500 mt-0.5">
                          Last: {new Date(lastEntry.created_at).toLocaleString()} · {lastEntry.type.replace("_", " ")}
                        </p>
                      ) : (
                        <p className="text-xs text-gray-400 mt-0.5">No activity yet</p>
                      )}
                      <p className={`mt-1 text-xs font-medium ${drawer?.active ? "text-blue-700" : "text-gray-400"}`}>
                        {drawer?.active ? "Open drawer shift" : "No active drawer shift"}
                      </p>
                    </div>
                    <div className="flex items-center justify-between sm:block sm:text-right">
                      <div className="contents">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 sm:hidden">
                          Expected
                        </p>
                        <p className={`${dashboardMetricValueClass} tabular-nums ${balance !== null ? "" : "text-gray-300"}`}>
                          {balance !== null ? fmtUsd(balance) : "—"}
                        </p>
                      </div>
                    </div>
                    <div className="flex sm:justify-end">
                      <Button
                        variant="secondary"
                        disabled={!drawer?.active}
                        onClick={() => { setCloseoutTerminalId(t.id); setCloseoutAmount(""); setCloseoutResult(null) }}
                        className="w-full rounded-xl sm:w-auto"
                      >
                        Close Drawer
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>

          </div>

        </section>

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
