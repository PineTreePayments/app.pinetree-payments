"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { logRecoveryDiagnostic } from "@/lib/auth/recovery"
import { supabase } from "@/lib/supabaseClient"

type RecoveryPhase =
  | "checking"
  | "ready"
  | "invalid"
  | "cleaning"
  | "cleanup-error"
  | "success"

type ResetPasswordClientProps = {
  recoveryAuthorized: boolean
}

export default function ResetPasswordClient({
  recoveryAuthorized,
}: ResetPasswordClientProps) {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [phase, setPhase] = useState<RecoveryPhase>("checking")
  const [errorMsg, setErrorMsg] = useState("")
  const submittingRef = useRef(false)
  const recoverySessionClearedRef = useRef(false)

  useEffect(() => {
    let active = true

    async function validateRecoverySession() {
      if (!recoveryAuthorized) {
        logRecoveryDiagnostic("form.authorization.missing")
        if (active) setPhase("invalid")
        return
      }

      let sessionResult: Awaited<ReturnType<typeof supabase.auth.getSession>>
      try {
        sessionResult = await supabase.auth.getSession()
      } catch {
        logRecoveryDiagnostic("form.session.invalid", { errorCode: "request_failed" })
        if (active) setPhase("invalid")
        return
      }
      const {
        data: { session },
        error: sessionError,
      } = sessionResult

      if (!session || sessionError) {
        logRecoveryDiagnostic("form.session.invalid", {
          errorCode: sessionError?.code ?? "missing_session",
        })
        if (active) setPhase("invalid")
        return
      }

      let userResult: Awaited<ReturnType<typeof supabase.auth.getUser>>
      try {
        userResult = await supabase.auth.getUser()
      } catch {
        logRecoveryDiagnostic("form.session.invalid", { errorCode: "user_request_failed" })
        if (active) setPhase("invalid")
        return
      }
      const { data: userData, error: userError } = userResult
      const validUser = userData.user?.id === session.user.id

      logRecoveryDiagnostic("form.session.checked", {
        hasSession: true,
        validUser,
        errorCode: userError?.code ?? null,
      })

      if (!active) return
      setPhase(!userError && validUser ? "ready" : "invalid")
    }

    void validateRecoverySession()
    return () => {
      active = false
    }
  }, [recoveryAuthorized])

  async function finalizeRecovery() {
    setPhase("cleaning")
    setErrorMsg("")

    if (!recoverySessionClearedRef.current) {
      let signOutResult: Awaited<ReturnType<typeof supabase.auth.signOut>>
      try {
        signOutResult = await supabase.auth.signOut({ scope: "local" })
      } catch (caughtError) {
        const message = caughtError instanceof Error ? caughtError.message : "Recovery sign-out failed."
        logRecoveryDiagnostic("cleanup.signout.failed", { errorCode: "request_failed" })
        setErrorMsg(`Your password was updated, but sign-out cleanup failed: ${message}`)
        setPhase("cleanup-error")
        return
      }
      const { error: signOutError } = signOutResult
      if (signOutError) {
        logRecoveryDiagnostic("cleanup.signout.failed", {
          errorCode: signOutError.code ?? "unknown",
        })
        setErrorMsg(`Your password was updated, but sign-out cleanup failed: ${signOutError.message}`)
        setPhase("cleanup-error")
        return
      }

      let remainingSessionResult: Awaited<ReturnType<typeof supabase.auth.getSession>>
      try {
        remainingSessionResult = await supabase.auth.getSession()
      } catch {
        logRecoveryDiagnostic("cleanup.session_check_failed")
        setErrorMsg("Your password was updated, but recovery cleanup could not be verified. Try again.")
        setPhase("cleanup-error")
        return
      }
      const remainingSession = remainingSessionResult.data.session
      if (remainingSession) {
        logRecoveryDiagnostic("cleanup.session.remained")
        setErrorMsg("Your password was updated, but the recovery session could not be cleared. Try again.")
        setPhase("cleanup-error")
        return
      }
      recoverySessionClearedRef.current = true
    }

    try {
      const response = await fetch("/auth/recovery/complete", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
      })
      if (!response.ok) throw new Error("Recovery marker cleanup failed")
    } catch {
      logRecoveryDiagnostic("cleanup.marker.failed")
      setErrorMsg("Your password was updated, but recovery cleanup did not finish. Try again.")
      setPhase("cleanup-error")
      return
    }

    window.history.replaceState(window.history.state, "", "/reset-password")
    logRecoveryDiagnostic("cleanup.completed", { hasSession: false })
    setPhase("success")
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current || phase !== "ready") return

    setErrorMsg("")

    if (password.length < 11) {
      setErrorMsg("Password must be at least 11 characters.")
      return
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
      setErrorMsg("Password must include uppercase, lowercase, and a number.")
      return
    }
    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match.")
      return
    }

    submittingRef.current = true
    setPhase("cleaning")
    logRecoveryDiagnostic("password.update.started")

    let updateResult: Awaited<ReturnType<typeof supabase.auth.updateUser>>
    try {
      updateResult = await supabase.auth.updateUser({ password })
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Password update failed."
      logRecoveryDiagnostic("password.update.failed", { errorCode: "request_failed" })
      setErrorMsg(message)
      setPhase("ready")
      submittingRef.current = false
      return
    }
    const { data, error } = updateResult

    if (error || !data.user) {
      logRecoveryDiagnostic("password.update.failed", {
        errorCode: error?.code ?? "missing_user",
        status: error?.status ?? null,
      })
      setErrorMsg(error?.message ?? "Supabase did not return an updated user.")
      setPhase("ready")
      submittingRef.current = false
      return
    }

    let sessionResult: Awaited<ReturnType<typeof supabase.auth.getSession>>
    try {
      sessionResult = await supabase.auth.getSession()
    } catch {
      logRecoveryDiagnostic("password.update.session_check_failed", {
        errorCode: "request_failed",
      })
      setErrorMsg("The password was updated, but the recovery session could not be verified for cleanup.")
      setPhase("cleanup-error")
      submittingRef.current = false
      return
    }
    const {
      data: { session },
      error: sessionError,
    } = sessionResult
    if (sessionError || !session || session.user.id !== data.user.id) {
      logRecoveryDiagnostic("password.update.session_check_failed", {
        errorCode: sessionError?.code ?? "missing_session",
      })
      setErrorMsg("The password was updated, but the recovery session could not be verified for cleanup.")
      setPhase("cleanup-error")
      submittingRef.current = false
      return
    }

    logRecoveryDiagnostic("password.update.succeeded", { hasUser: true })
    setPassword("")
    setConfirmPassword("")
    submittingRef.current = false
    await finalizeRecovery()
  }

  function goToSignIn() {
    window.location.replace("/login")
  }

  const busy = phase === "checking" || phase === "cleaning"

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-6 sm:min-h-screen sm:px-0 sm:py-0">
      <div className="absolute inset-0 h-[100dvh] bg-cover bg-center sm:h-auto wave-bg"></div>

      <div className="relative z-10 w-full max-w-md rounded-xl bg-white/90 p-6 shadow-xl backdrop-blur-xl">
        <div className="mb-4 flex justify-center">
          <Image src="/pinetree-web-logo.png" alt="PineTree" width={95} height={36} />
        </div>

        <h1 className="mb-2 text-center text-lg font-semibold text-gray-900">
          Create a new password
        </h1>
        <p className="mb-5 text-center text-sm text-gray-600">
          Enter a new password for your PineTree account.
        </p>

        {phase === "checking" ? (
          <p className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700" role="status">
            Checking your reset link...
          </p>
        ) : phase === "success" ? (
          <div className="space-y-4">
            <p className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700" role="status">
              Password updated. Sign in with your new password.
            </p>
            <button
              type="button"
              onClick={goToSignIn}
              className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 py-2.5 font-medium text-white transition hover:bg-blue-700"
            >
              Continue to sign in
            </button>
          </div>
        ) : phase === "invalid" ? (
          <div className="space-y-4">
            <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
              This reset link is invalid, expired, or has already been used. Request a new password reset link.
            </p>
            <Link
              href="/forgot-password"
              className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 py-2.5 font-medium text-white transition hover:bg-blue-700"
            >
              Request a new link
            </Link>
          </div>
        ) : phase === "cleanup-error" ? (
          <div className="space-y-4">
            <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
              {errorMsg}
            </p>
            <button
              type="button"
              onClick={() => void finalizeRecovery()}
              className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 py-2.5 font-medium text-white transition hover:bg-blue-700"
            >
              Finish cleanup
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label htmlFor="new-password" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 11 characters"
              disabled={busy}
              className="mb-3 w-full rounded-md border border-gray-300 p-2.5 text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
            />

            <label htmlFor="confirm-password" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Confirm password
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Re-enter password"
              disabled={busy}
              className="mb-3 w-full rounded-md border border-gray-300 p-2.5 text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
            />

            {errorMsg && <p className="mb-3 text-sm text-red-600" role="alert">{errorMsg}</p>}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-blue-600 py-2.5 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Updating..." : "Update password"}
            </button>
          </form>
        )}

        {phase !== "success" && (
          <p className="mt-4 text-center text-xs text-gray-600">
            <Link href="/login" className="font-medium text-blue-600 transition hover:text-blue-700">
              Back to sign in
            </Link>
          </p>
        )}
      </div>

      <style jsx>{`
        .wave-bg {
          background-image: url("/pinetree-app-bg.png");
          background-size: cover;
          background-position: center;
          animation: waveMove 18s ease-in-out infinite alternate;
          transform: scale(1.05);
        }

        @media (max-width: 640px) {
          .wave-bg {
            background-image:
              radial-gradient(circle at 12% 18%, rgba(0, 82, 255, 0.22), transparent 34%),
              radial-gradient(circle at 18% 78%, rgba(92, 80, 255, 0.2), transparent 36%),
              radial-gradient(circle at 86% 16%, rgba(255, 156, 64, 0.16), transparent 28%),
              url("/pinetree-app-bg.png");
            background-position: center, center, center, 45% center;
            background-size: 100% 100%, 100% 100%, 100% 100%, auto 100%;
            transform: scale(1.02);
          }
        }

        @keyframes waveMove {
          0% { transform: scale(1.05) translateY(0px); }
          50% { transform: scale(1.07) translateY(-15px); }
          100% { transform: scale(1.05) translateY(10px); }
        }

        @media (max-width: 640px) {
          @keyframes waveMove {
            0% { transform: scale(1.02) translateY(0px); }
            50% { transform: scale(1.03) translateY(-8px); }
            100% { transform: scale(1.02) translateY(6px); }
          }
        }
      `}</style>
    </div>
  )
}
