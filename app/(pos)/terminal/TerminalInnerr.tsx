"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import POSLayout from "@/components/pos/POSLayout"
import Keypad from "@/components/pos/Keypad"

type Toast = {
  id: string
  message: string
  type: "success" | "error"
}

type Terminal = {
  id: string
  name: string
  pin: string
  autolock: string
  merchant_id?: string
}

type TerminalContext = {
  merchantId: string
  terminalId: string
  provider: string
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

      if (terminalData.merchant_id) {
        setTerminalContext({
          terminalId: terminalData.id,
          merchantId: terminalData.merchant_id,
          provider: String(payload.provider || "solana")
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

  function handleDigitsChange(next: string | ((prev: string) => string)) {
    const resolved = typeof next === "function" ? next(digits) : next

    if (!terminal || resolved.length !== 4 || isRedirecting) {
      setDigits(resolved)
      return
    }

    if (resolved === terminal.pin) {
      showToast("Terminal unlocked", "success")
      setIsRedirecting(true)
      setTimeout(() => {
        router.push("/dashboard/pos")
      }, 700)
      setDigits(resolved)
      return
    }

    showToast("Incorrect PIN", "error")
    setDigits("")
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

      setTerminal((prev) => (prev ? { ...prev, pin: recoveryPin } : prev))
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

      {!unlockMode && (
        <POSLayout locked={false} terminalContext={terminalContext} />
      )}

      {unlockMode && (

        <div className="bg-white shadow-xl rounded-2xl p-12 w-[420px]">

          <div className="text-center mb-8">

            <div className="text-lg font-semibold text-black">
              Enter PIN
            </div>

            <div className="text-4xl tracking-[0.35em] mt-2 text-gray-900 font-semibold">
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
            className="mt-6 text-sm text-gray-500 hover:text-gray-700 w-full text-center"
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
              <div className="flex gap-2">
                <button
                  onClick={recoverPin}
                  disabled={recoveryBusy}
                  className="flex-1 bg-[#0052FF] text-white rounded-md py-2 text-sm disabled:opacity-60"
                >
                  {recoveryBusy ? "Resetting..." : "Reset PIN"}
                </button>
                <button
                  onClick={() => setShowRecovery(false)}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-700"
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