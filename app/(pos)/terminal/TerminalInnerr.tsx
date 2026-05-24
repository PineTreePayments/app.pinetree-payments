"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import POSLayout from "@/components/pos/POSLayout"
import Keypad from "@/components/pos/Keypad"
import Button from "@/components/ui/Button"

type Toast = {
  id: string
  message: string
  type: "success" | "error"
}

type Terminal = {
  id: string
  name: string
  autolock: string
  merchant_id?: string
  drawer_starting_amount?: number
}

type TerminalContext = {
  merchantId: string
  terminalId: string
  provider: string
  sessionToken: string
}

type DrawerSession = {
  balance: number
  active: boolean
  lastEntryType: string | null
  lastEntryAt: string | null
}

export default function TerminalInner() {

  const router = useRouter()
  const params = useSearchParams()

  const terminalId = params.get("tid")

  const [terminal,setTerminal] = useState<Terminal | null>(null)
  const [unlockMode,setUnlockMode] = useState(false)
  const [digits,setDigits] = useState("")
  const [toasts,setToasts] = useState<Toast[]>([])
  const [isRedirecting,setIsRedirecting] = useState(false)
  const [terminalContext, setTerminalContext] = useState<TerminalContext | null>(null)
  const [showRecovery, setShowRecovery] = useState(false)
  const [recoveryPhrase, setRecoveryPhrase] = useState("")
  const [recoveryPin, setRecoveryPin] = useState("")
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [shiftStarted, setShiftStarted] = useState(false)
  const [shiftStarting, setShiftStarting] = useState(false)
  const [drawerSession, setDrawerSession] = useState<DrawerSession | null>(null)
  const [pendingProvider, setPendingProvider] = useState<string>("solana")

  function showToast(message:string,type:"success"|"error"){

    const id = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 10000)}`

    setToasts(prev => [...prev,{id,message,type}])

    setTimeout(()=>{
      setToasts(prev => prev.filter(t => t.id !== id))
    },3000)

  }

  useEffect(()=>{

    async function loadTerminal(){

      if(!terminalId) return

      const res = await fetch(`/api/pos/terminal-session?tid=${encodeURIComponent(terminalId)}`, {
        cache: "no-store"
      })

      const payload = await res.json().catch(() => null)

      if (!res.ok || !payload?.terminal) {
        console.error(payload?.error || "Failed to load terminal session")
        return
      }

      const terminalData = payload.terminal as Terminal
      setTerminal(terminalData)
      const drawer = (payload.drawer || null) as DrawerSession | null
      setDrawerSession(drawer)
      setShiftStarted(Boolean(drawer?.active) || Number(terminalData.drawer_starting_amount ?? 0) === 0)
      const provider = String(payload.provider || "solana")
      setPendingProvider(provider)

      if (payload.sessionToken && terminalData.merchant_id) {
        setTerminalContext({
          terminalId: terminalData.id,
          merchantId: terminalData.merchant_id,
          provider,
          sessionToken: String(payload.sessionToken)
        })
      }

    }

    loadTerminal()

  },[terminalId])

  useEffect(() => {
    if (!unlockMode) return
    window.history.pushState({ posLocked: true }, "", window.location.href)

    function handlePopState() {
      window.history.pushState({ posLocked: true }, "", window.location.href)
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [unlockMode])

  async function handleDigitsChange(next: string | ((prev: string) => string)) {
    const resolved = typeof next === "function" ? next(digits) : next

    if (!terminal || resolved.length !== 4 || isRedirecting) {
      setDigits(resolved)
      return
    }

    // 4 digits entered — verify server-side; never compare PIN in the browser
    setDigits(resolved)
    setIsRedirecting(true)

    try {
      const res = await fetch("/api/pos/terminal-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminalId: terminal.id, pin: resolved })
      })

      const data = await res.json().catch(() => null) as { sessionToken?: string } | null

      if (!res.ok) {
        setIsRedirecting(false)
        showToast("Incorrect PIN", "error")
        setDigits("")
        return
      }

      if (data?.sessionToken && terminal.merchant_id) {
        setTerminalContext({
          terminalId: terminal.id,
          merchantId: terminal.merchant_id,
          provider: pendingProvider,
          sessionToken: String(data.sessionToken)
        })
      }

      showToast("Terminal unlocked", "success")
      setTimeout(() => {
        router.push("/dashboard/pos")
      }, 700)
    } catch {
      setIsRedirecting(false)
      showToast("Incorrect PIN", "error")
      setDigits("")
    }
  }

  function requestUnlock(){
    setUnlockMode(true)
    setDigits("")
    setShowRecovery(false)
  }

  function cancelUnlock(){
    setUnlockMode(false)
    setDigits("")
    setShowRecovery(false)
    setRecoveryPhrase("")
    setRecoveryPin("")
  }

  async function confirmShiftStart() {
    if (!terminal?.id || !terminalContext?.sessionToken) return
    setShiftStarting(true)
    try {
      const res = await fetch("/api/pos/drawer/open", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${terminalContext.sessionToken}`,
        },
        body: JSON.stringify({
          startingAmount: Number(terminal.drawer_starting_amount ?? 0),
        }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to start shift")
      }
      if (payload?.entry) {
        setDrawerSession({
          balance: Number(payload.entry.running_balance || 0),
          active: true,
          lastEntryType: String(payload.entry.type || "opening_balance"),
          lastEntryAt: String(payload.entry.created_at || "")
        })
      }
      setShiftStarted(true)
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to start shift", "error")
    } finally {
      setShiftStarting(false)
    }
  }

  async function recoverPin() {
    if (!terminal?.id) return
    if (!recoveryPhrase.trim()) {
      showToast("Enter recovery phrase", "error")
      return
    }
    if (recoveryPin.length !== 4) {
      showToast("New PIN must be 4 digits", "error")
      return
    }

    try {
      setRecoveryBusy(true)
      const res = await fetch("/api/pos/terminal-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          terminalId: terminal.id,
          recoveryPhrase,
          newPin: recoveryPin
        })
      })

      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        showToast(String(payload?.error || "Recovery failed"), "error")
        return
      }

      setRecoveryPin("")
      setRecoveryPhrase("")
      setShowRecovery(false)
      showToast("PIN reset. Enter new PIN to unlock.", "success")
    } catch {
      showToast("Recovery failed", "error")
    } finally {
      setRecoveryBusy(false)
    }
  }

  return (

    <div className="h-screen w-screen bg-gray-100 flex items-center justify-center relative">

      {terminal && unlockMode && (

        <div className="absolute top-6 left-1/2 -translate-x-1/2 text-center">

          <div className="text-sm text-gray-600 font-medium">
            POS {terminal.id}
          </div>

        </div>

      )}

      <div className="fixed right-6 top-24 space-y-3 z-50">

        {toasts.map((toast)=>(
          <div
            key={toast.id}
            className={`px-4 py-3 rounded-md shadow-lg text-white text-sm font-medium ${
              toast.type === "success"
                ? "bg-green-600"
                : "bg-red-600"
            }`}
          >
            {toast.message}
          </div>
        ))}

      </div>

      <button
        onClick={requestUnlock}
        className="absolute top-6 right-6 hover:scale-110 transition"
      >

        <svg width="34" height="34" viewBox="0 0 24 24" fill="none">

          <rect x="6" y="10" width="12" height="10" rx="2" fill="#0052FF"/>

          <path
            d="M8 10V7a4 4 0 118 0v3"
            stroke="#0052FF"
            strokeWidth="2"
            strokeLinecap="round"
          />

        </svg>

      </button>

      {!unlockMode && terminal && !shiftStarted && Number(terminal.drawer_starting_amount ?? 0) > 0 && (
        <div className="bg-white shadow-xl rounded-2xl p-8 w-[92vw] max-w-[420px] text-center space-y-5">
          <div>
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">{terminal.name}</p>
            <h1 className="text-2xl font-bold text-gray-900">Start Shift</h1>
          </div>
          <div className="bg-gray-50 rounded-xl p-5">
            <p className="text-xs uppercase tracking-widest text-gray-400 mb-1">Starting Cash Balance</p>
            <p className="text-4xl font-bold text-gray-900">
              {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
                Number(terminal.drawer_starting_amount ?? 0)
              )}
            </p>
          </div>
          <p className="text-sm text-gray-500">
            Confirm the starting cash in the drawer before beginning your shift.
          </p>
          {drawerSession?.lastEntryType === "closeout" && drawerSession.lastEntryAt && (
            <p className="text-xs text-gray-400">
              Last closeout: {new Date(drawerSession.lastEntryAt).toLocaleString()}
            </p>
          )}
          <Button
            fullWidth
            variant="primary"
            disabled={shiftStarting}
            onClick={confirmShiftStart}
          >
            {shiftStarting ? "Starting…" : "Confirm & Start Shift"}
          </Button>
          <button
            onClick={() => setShiftStarted(true)}
            className="inline-flex h-10 w-full items-center justify-center rounded-md border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:border-gray-300 hover:shadow-md active:bg-gray-100"
          >
            Skip (no drawer tracking)
          </button>
        </div>
      )}

      {!unlockMode && (terminal === null || shiftStarted || Number(terminal?.drawer_starting_amount ?? 0) === 0) && (
        <POSLayout locked={false} terminalContext={terminalContext} />
      )}

      {unlockMode && (

        <div className="bg-white shadow-xl rounded-2xl p-6 sm:p-12 w-[92vw] max-w-[420px]">

          <div className="text-center mb-8">

            <div className="text-lg font-semibold text-black">
              Enter PIN
            </div>

            <div className="text-3xl sm:text-4xl tracking-[0.35em] mt-2 text-gray-900 font-semibold">
              {"•".repeat(digits.length)}
            </div>

          </div>

          <Keypad
            digits={digits}
            setDigits={handleDigitsChange}
            maxLength={4}
          />

          <button
            onClick={cancelUnlock}
            className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-md border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:border-gray-300 hover:shadow-md active:bg-gray-100"
          >
            Cancel
          </button>

          {!showRecovery ? (
            <button
              onClick={() => setShowRecovery(true)}
              className="mt-3 text-sm text-blue-600 hover:text-blue-700 w-full text-center"
            >
              Use recovery phrase
            </button>
          ) : (
            <div className="mt-4 space-y-3">
              <input
                value={recoveryPhrase}
                onChange={(e) => setRecoveryPhrase(e.target.value)}
                placeholder="Recovery phrase"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-black"
              />
              <input
                value={recoveryPin}
                onChange={(e) => setRecoveryPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="New 4-digit PIN"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-black text-center tracking-widest"
              />
              <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    fullWidth
                    variant="primary"
                    disabled={recoveryBusy}
                    onClick={recoverPin}
                  >
                    {recoveryBusy ? "Resetting..." : "Reset PIN"}
                  </Button>
                <button
                  onClick={() => setShowRecovery(false)}
                  className="inline-flex h-10 items-center justify-center rounded-md border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:border-gray-300 hover:shadow-md active:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

        </div>

      )}

    </div>

  )

}
