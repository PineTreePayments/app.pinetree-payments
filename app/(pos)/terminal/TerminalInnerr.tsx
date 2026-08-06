"use client"

import { useCallback, useState, useEffect } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import POSLayout from "@/components/pos/POSLayout"
import Keypad from "@/components/pos/Keypad"
import Button from "@/components/ui/Button"

type Toast = {
  id: string
  message: string
  type: "success" | "error"
}

/**
 * Terminal display fields returned by the authenticated launch route. The
 * merchant binding and the `pts_` credential arrive alongside these, from the
 * same server-verified launch — never from client input.
 */
type Terminal = {
  id: string
  name: string
  autolock: string
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

function normalizeTerminalId(value: string | null): string {
  return String(value || "")
    .split("?")[0]
    .split("&")[0]
    .trim()
}

export default function TerminalInner() {

  const router = useRouter()
  const params = useSearchParams()

  const terminalId = normalizeTerminalId(params.get("tid"))

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
  const [showUnlockControl, setShowUnlockControl] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)

  const handleLockControlVisibilityChange = useCallback((visible: boolean) => {
    setShowUnlockControl(visible)
  }, [])

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

    /**
     * Authenticated terminal launch.
     *
     * The `/terminal` page is proxy-protected, so a merchant session already
     * exists; it is forwarded as a bearer token the same way the dashboard
     * calls its own APIs. The server derives the merchant from that session and
     * refuses a terminal the merchant does not own, so the POS can open
     * immediately — no PIN is involved in entering the terminal.
     *
     * This also makes refresh work: re-running this launch restores the POS for
     * as long as the merchant session is valid.
     */
    async function launchTerminal(){

      if(!terminalId){
        setLaunchError("Missing terminal id.")
        return
      }

      const { data: { session } } = await supabase.auth.getSession()
      const accessToken = session?.access_token

      if (!accessToken) {
        // No merchant session: do NOT fall back to a terminal-id-only request.
        setLaunchError("Your session has expired. Sign in again to open this terminal.")
        return
      }

      const res = await fetch(`/api/pos/terminal-session?tid=${encodeURIComponent(terminalId)}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      const payload = await res.json().catch(() => null)

      if (!res.ok || !payload?.terminal || !payload?.sessionToken) {
        setLaunchError(
          res.status === 401
            ? "Your session has expired. Sign in again to open this terminal."
            : String(payload?.error || "This terminal could not be opened.")
        )
        return
      }

      const terminalData = payload.terminal as Terminal
      setTerminal(terminalData)
      const drawer = (payload.drawer || null) as DrawerSession | null
      setDrawerSession(drawer)
      setShiftStarted(Boolean(drawer?.active) || Number(terminalData.drawer_starting_amount ?? 0) === 0)
      const provider = String(payload.provider || "solana")

      // The credential and its tenant binding both come from this verified
      // launch. The POS opens as soon as this is set.
      setTerminalContext({
        terminalId: terminalData.id,
        merchantId: String(payload.merchantId),
        provider,
        sessionToken: String(payload.sessionToken),
      })
      setLaunchError(null)

    }

    launchTerminal()

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

  /**
   * Exit-PIN entry. The PIN authorizes LEAVING the terminal, never entering it.
   *
   * The active `pts_` session is sent so the server can only ever be asked about
   * the terminal that is currently open. The token is kept until the server
   * confirms the PIN — a wrong PIN must leave the cashier inside the terminal
   * with a working session.
   */
  async function handleDigitsChange(next: string | ((prev: string) => string)) {
    const resolved = typeof next === "function" ? next(digits) : next

    if (!terminal || resolved.length !== 4 || isRedirecting) {
      setDigits(resolved)
      return
    }

    const activeToken = terminalContext?.sessionToken
    if (!activeToken) {
      setDigits("")
      showToast("Terminal session unavailable", "error")
      return
    }

    // 4 digits entered — verify server-side; never compare PIN in the browser
    setDigits(resolved)
    setIsRedirecting(true)

    try {
      const res = await fetch("/api/pos/terminal-exit-auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeToken}`,
        },
        body: JSON.stringify({ pin: resolved })
      })

      if (!res.ok) {
        // Stay inside the terminal. The session is deliberately untouched.
        setIsRedirecting(false)
        const message = res.status === 429
          ? "Too many attempts. Please wait before trying again."
          : "Incorrect PIN"
        showToast(message, "error")
        setDigits("")
        return
      }

      // Exit authorized. Drop the credential from client state before leaving so
      // it cannot be reused by whatever renders next, then return to the
      // dashboard. No replacement token is issued.
      setTerminalContext(null)
      setShowRecovery(false)
      setDigits("")
      showToast("Terminal locked", "success")
      router.push("/dashboard/pos")
    } catch {
      setIsRedirecting(false)
      showToast("Incorrect PIN", "error")
      setDigits("")
    }
  }

  /** Opens the exit-PIN dialog over the active POS. */
  function requestUnlock(){
    setUnlockMode(true)
    setDigits("")
    setShowRecovery(false)
  }

  /** Dismisses the exit dialog and returns to the POS with the session intact. */
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

  // The session comes from the authenticated launch, so it is present as soon as
  // the terminal loads. It gates the POS only so that nothing renders before the
  // launch succeeds — it is NOT an entry-authentication gate, and it is never
  // satisfied by entering a PIN. `unlockMode` is the exit dialog and nothing else.
  const hasTerminalSession = Boolean(terminalContext?.sessionToken)

  if (launchError) {
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center bg-gray-100 px-6">
        <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 text-center shadow-xl">
          <div className="text-lg font-semibold text-gray-900">Terminal unavailable</div>
          <p className="text-sm text-gray-600">{launchError}</p>
          <Link
            href="/dashboard/pos"
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-[#0052FF] px-4 text-sm font-semibold text-white"
          >
            Back to Point of Sale
          </Link>
        </div>
      </div>
    )
  }

  if (!terminal || !hasTerminalSession) {
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center bg-gray-100">
        <div className="text-sm font-medium text-gray-500">
          {terminalId ? "Loading terminal..." : "Missing terminal id"}
        </div>
      </div>
    )
  }

  return (

    <div className="relative flex h-[100dvh] w-full items-center justify-center overflow-hidden overscroll-none bg-gray-100 px-[max(0.75rem,env(safe-area-inset-left))] py-[calc(env(safe-area-inset-top)+0.75rem)] pb-[calc(env(safe-area-inset-bottom)+0.75rem)] touch-manipulation">

      {terminal && unlockMode && (

        <div className="absolute left-1/2 top-[calc(env(safe-area-inset-top)+1rem)] -translate-x-1/2 text-center">

          <div className="text-sm text-gray-600 font-medium">
            POS {terminal.id}
          </div>

        </div>

      )}

      <div className="fixed right-[max(1rem,env(safe-area-inset-right))] top-[calc(env(safe-area-inset-top)+4.5rem)] z-50 space-y-3">

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

      {!unlockMode && (shiftStarted || Number(terminal.drawer_starting_amount ?? 0) === 0) && showUnlockControl ? (
        <button
          onClick={requestUnlock}
          className="absolute right-[max(1rem,env(safe-area-inset-right))] top-[calc(env(safe-area-inset-top)+3rem)] touch-manipulation transition hover:scale-110"
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
      ) : null}

      {!unlockMode && terminal && !shiftStarted && Number(terminal.drawer_starting_amount ?? 0) > 0 && (
        <div className="max-h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom)_-_1.5rem)] w-full max-w-[420px] space-y-5 overflow-y-auto rounded-2xl bg-white p-6 text-center shadow-xl sm:p-8">
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

      {!unlockMode && (shiftStarted || Number(terminal.drawer_starting_amount ?? 0) === 0) && (
        <POSLayout
          locked={false}
          terminalContext={terminalContext}
          onLockControlVisibilityChange={handleLockControlVisibilityChange}
        />
      )}

      {unlockMode && (

        <div className="max-h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom)_-_1.5rem)] w-full max-w-[420px] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-10">

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

          {/* Dismissing the exit dialog returns to the active POS with the
              terminal session untouched. */}
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-base text-black sm:text-sm"
              />
              <input
                value={recoveryPin}
                onChange={(e) => setRecoveryPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="New 4-digit PIN"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-center text-base tracking-widest text-black sm:text-sm"
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
