"use client"

import Link from "next/link"
import { useState, useEffect, useRef, useCallback } from "react"
import { Eye, EyeOff } from "lucide-react"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"
import Button from "@/components/ui/Button"
import Card from "@/components/ui/Card"

type Terminal = {
  id: string
  name: string
  pin: string
  autolock: string
  merchant_id?: string
  drawer_starting_amount?: number
  created_at?: string
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
  lastEntry: DrawerEntry | null
  log: DrawerEntry[]
}

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
  const detailsRef = useRef<HTMLDivElement | null>(null)

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
      const payload = await callPosTerminalsApi("GET") as { terminals?: Terminal[] }
      const list = payload.terminals || []
      setTerminals(list)
      void loadDrawerBalances(list)
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Failed to load terminals")
    }
  }, [callPosTerminalsApi])

  async function loadDrawerBalances(terminalList: Terminal[]) {
    const results = await Promise.allSettled(
      terminalList.map(async (t) => {
        const res = await fetch(`/api/pos/drawer/balance?terminalId=${encodeURIComponent(t.id)}`, {
          cache: "no-store",
          credentials: "include"
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

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null
      if (!target) return
      if (detailsRef.current?.contains(target)) return
      setExpandedTerminalId(null)
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setExpandedTerminalId(null)
      }
    }

    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleEscape)

    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [expandedTerminalId])

  /* CREATE TERMINAL */

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

    try {
      const payload = await callPosTerminalsApi("POST", {
        name,
        pin,
        recoveryPhrase,
        autolock: autoLock,
        drawer_starting_amount: drawerStartingAmount ? Number(drawerStartingAmount) : 0
      }) as { terminal?: Terminal }

      if (payload.terminal) {
        setTerminals(prev => [payload.terminal as Terminal, ...prev])
      }

      setName("")
      setPin("")
      setRecoveryPhrase("")
      setAutoLock("5")
      setDrawerStartingAmount("")
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

  return (

    <div className="space-y-8 relative">

      {/* DELETE CONFIRM MODAL */}

      {confirmDelete && (

        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">

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

              <button
                onClick={()=>{
                  if(terminalToDelete){
                    deleteTerminal(terminalToDelete)
                  }
                  setConfirmDelete(false)
                }}
                className="px-4 py-2.5 text-sm bg-red-600 text-white rounded-xl font-medium hover:bg-red-700"
              >
                Delete Terminal
              </button>

            </div>

          </Card>

        </div>

      )}

      {/* HEADER */}

      <div>

        <h1 className="text-2xl font-semibold text-gray-900">
          Point of Sale
        </h1>

        <p className="text-sm text-gray-500 mt-1">
          Manage POS terminals and launch checkout.
        </p>

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

          </div>

          <div className="flex flex-col sm:flex-row gap-3 mt-6">

            <Button onClick={createTerminal}>
              Create Terminal
            </Button>

            <Button variant="secondary" onClick={()=>setCreating(false)}>
              Cancel
            </Button>

          </div>

        </div>

      )}

      {/* TERMINAL LIST */}

      <Card>

        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">

          <h2 className="text-lg font-semibold text-gray-900">
            Active Terminals
          </h2>

          <Button onClick={()=>setCreating(true)}>
            + New Terminal
          </Button>

        </div>

        {terminals.length === 0 && (

          <div className="text-sm text-gray-500">
            No terminals created yet.
          </div>

        )}

        <div className="space-y-4">

          {terminals.map((t)=>(

            <div
              key={t.id}
              ref={expandedTerminalId === t.id ? detailsRef : null}
              className="border border-gray-200 rounded-xl p-4 flex flex-col md:flex-row md:justify-between md:items-center gap-4 relative"
            >

              <div>

                <div className="font-semibold text-gray-900">
                  {t.name}
                </div>

                <div className="text-sm text-gray-500">
                  {t.id}
                </div>

                <div className="text-sm text-green-600 mt-1">
                  ● Active
                </div>

              </div>

              <div className="flex flex-wrap gap-2 items-center md:justify-end">

                <Button variant="secondary" onClick={() => toggleTerminalDetails(t.id)}>
                  {expandedTerminalId === t.id ? "Hide details" : "Details"}
                </Button>

                <Link
                  href={`/terminal?tid=${t.id}`}
                  className="inline-flex items-center justify-center font-semibold text-sm rounded-full h-[46px] px-6 transition-all active:scale-[0.98] text-white hover:brightness-110"
                  style={{ background: "linear-gradient(135deg, #5cc8ff 0%, #7d3fe0 100%)" }}
                >
                  Launch
                </Link>

                <Button
                  variant="secondary"
                  onClick={()=>{
                    setTerminalToDelete(t.id)
                    setConfirmDelete(true)
                  }}
                >
                  Delete
                </Button>

              </div>

              {expandedTerminalId === t.id && (
                <div className="md:absolute md:right-4 md:top-14 z-20 w-full md:w-72 bg-white border border-gray-200 rounded-xl shadow-xl p-3 text-xs text-gray-600 space-y-1">
                  <div><span className="font-medium text-gray-800">Auto-lock:</span> {formatAutoLock(t.autolock)}</div>
                  <div><span className="font-medium text-gray-800">Merchant:</span> {t.merchant_id || "-"}</div>
                  <div>
                    <span className="font-medium text-gray-800">Created:</span>{" "}
                    {t.created_at ? new Date(t.created_at).toLocaleString() : "-"}
                  </div>
                </div>
              )}

            </div>

          ))}

        </div>

      </Card>

      {/* DRAWER BALANCES */}

      {terminals.length > 0 && (
        <Card>

          <h2 className="text-lg font-semibold text-gray-900 mb-4">Drawer Balances</h2>

          <div className="space-y-3">
            {terminals.map((t) => {
              const drawer = drawerBalances[t.id]
              const balance = drawer?.balance ?? null
              const lastEntry = drawer?.lastEntry
              return (
                <div key={t.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border border-gray-200 rounded-xl p-4">
                  <div>
                    <p className="font-medium text-gray-900">{t.name}</p>
                    {lastEntry ? (
                      <p className="text-xs text-gray-500 mt-0.5">
                        Last activity: {new Date(lastEntry.created_at).toLocaleString()} · {lastEntry.type.replace("_", " ")}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400 mt-0.5">No activity yet</p>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs uppercase tracking-widest text-gray-400">Expected Balance</p>
                      <p className={`text-xl font-bold ${balance !== null ? "text-gray-900" : "text-gray-300"}`}>
                        {balance !== null ? fmtUsd(balance) : "—"}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => { setCloseoutTerminalId(t.id); setCloseoutAmount(""); setCloseoutResult(null) }}
                    >
                      Closeout
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>

      </Card>
      )}

      {/* CLOSEOUT MODAL */}

      {closeoutTerminalId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
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
