"use client"

import Link from "next/link"
import { useState, useEffect, useRef, useCallback } from "react"
import { Eye, EyeOff } from "lucide-react"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"

type Terminal = {
  id: string
  name: string
  pin: string
  autolock: string
  merchant_id?: string
  created_at?: string
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
      setTerminals(payload.terminals || [])
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Failed to load terminals")
    }
  }, [callPosTerminalsApi])

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
        autolock: autoLock
      }) as { terminal?: Terminal }

      if (payload.terminal) {
        setTerminals(prev => [payload.terminal as Terminal, ...prev])
      }

      setName("")
      setPin("")
      setRecoveryPhrase("")
      setAutoLock("5")

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

          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-lg">

            <h2 className="text-lg font-semibold mb-2 text-gray-900">
              Delete Terminal
            </h2>

            <p className="text-sm text-gray-600 mb-6">
              Are you sure you want to delete this terminal?
            </p>

            <div className="flex justify-end gap-3">

              <button
                onClick={()=>setConfirmDelete(false)}
                className="px-4 py-2 text-sm border rounded-lg"
              >
                Cancel
              </button>

              <button
                onClick={()=>{
                  if(terminalToDelete){
                    deleteTerminal(terminalToDelete)
                  }
                  setConfirmDelete(false)
                }}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg"
              >
                Delete Terminal
              </button>

            </div>

          </div>

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

        <div ref={formRef} className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">

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
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-black"
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
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-black"
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
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-center tracking-widest text-black"
                />

                <button
                  type="button"
                  onClick={()=>setShowPin(!showPin)}
                  className="absolute right-3 top-2 text-gray-500"
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
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-black"
              >
                <option value="1">1 minute</option>
                <option value="3">3 minutes</option>
                <option value="5">5 minutes</option>
                <option value="10">10 minutes</option>
                <option value="never">Never</option>
              </select>

            </div>

          </div>

          <div className="flex flex-col sm:flex-row gap-3 mt-6">

            <button
              onClick={createTerminal}
              className="bg-[#0052FF] text-white px-5 py-2 rounded-md text-sm"
            >
              Create Terminal
            </button>

            <button
              onClick={()=>setCreating(false)}
              className="bg-gray-200 text-gray-700 px-5 py-2 rounded-md text-sm"
            >
              Cancel
            </button>

          </div>

        </div>

      )}

      {/* TERMINAL LIST */}

      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">

        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">

          <h2 className="text-lg font-semibold text-gray-900">
            Active Terminals
          </h2>

          <button
            onClick={()=>setCreating(true)}
            className="bg-[#0052FF] text-white px-4 py-2 rounded-md text-sm hover:opacity-90"
          >
            + New Terminal
          </button>

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
              className="border border-gray-200 rounded-lg p-4 flex flex-col md:flex-row md:justify-between md:items-center gap-4 relative"
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

                <button
                  onClick={() => toggleTerminalDetails(t.id)}
                  className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-sm rounded-md hover:bg-gray-50"
                >
                  {expandedTerminalId === t.id ? "Hide details" : "Details"}
                </button>

                <Link
                  href={`/terminal?tid=${t.id}`}
                  className="px-3 py-1.5 bg-[#0052FF] text-white text-sm rounded-md hover:opacity-90"
                >
                  Launch
                </Link>

                <button
                  onClick={()=>{
                    setTerminalToDelete(t.id)
                    setConfirmDelete(true)
                  }}
                  className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-300"
                >
                  Delete
                </button>

              </div>

              {expandedTerminalId === t.id && (
                <div className="md:absolute md:right-4 md:top-14 z-20 w-full md:w-72 bg-white border border-gray-200 rounded-lg shadow-xl p-3 text-xs text-gray-600 space-y-1">
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

      </div>

    </div>

  )

}