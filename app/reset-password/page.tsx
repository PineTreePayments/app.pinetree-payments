"use client"

import { FormEvent, useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { supabase } from "@/lib/supabaseClient"

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [hasResetSession, setHasResetSession] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  const [successMsg, setSuccessMsg] = useState("")

  useEffect(() => {
    let active = true

    async function checkSession() {
      const { data } = await supabase.auth.getSession()
      if (!active) return
      setHasResetSession(Boolean(data.session))
      setCheckingSession(false)
    }

    void checkSession()

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) {
        setHasResetSession(Boolean(session))
        setCheckingSession(false)
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMsg("")
    setSuccessMsg("")

    if (password.length < 8) {
      setErrorMsg("Password must be at least 8 characters.")
      return
    }
    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match.")
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setErrorMsg(
        process.env.NODE_ENV === "development"
          ? error.message
          : "We could not update your password. Please request a new reset link."
      )
      return
    }

    setPassword("")
    setConfirmPassword("")
    setSuccessMsg("Your password has been updated.")
  }

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

        {checkingSession ? (
          <p className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">
            Checking your reset link...
          </p>
        ) : successMsg ? (
          <div className="space-y-4">
            <p className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">
              {successMsg}
            </p>
            <Link
              href="/login"
              className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 py-2.5 font-medium text-white transition hover:bg-blue-700"
            >
              Continue to sign in
            </Link>
          </div>
        ) : !hasResetSession ? (
          <div className="space-y-4">
            <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
              This reset link is invalid or expired. Request a new password reset link.
            </p>
            <Link
              href="/forgot-password"
              className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 py-2.5 font-medium text-white transition hover:bg-blue-700"
            >
              Request a new link
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              New password
            </label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              className="mb-3 w-full rounded-md border border-gray-300 p-2.5 text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />

            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Confirm password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Re-enter password"
              className="mb-3 w-full rounded-md border border-gray-300 p-2.5 text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />

            {errorMsg && <p className="mb-3 text-sm text-red-600">{errorMsg}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-blue-600 py-2.5 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Updating..." : "Update password"}
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-xs text-gray-600">
          <Link href="/login" className="font-medium text-blue-600 transition hover:text-blue-700">
            Back to sign in
          </Link>
        </p>
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
          0% {
            transform: scale(1.05) translateY(0px);
          }
          50% {
            transform: scale(1.07) translateY(-15px);
          }
          100% {
            transform: scale(1.05) translateY(10px);
          }
        }

        @media (max-width: 640px) {
          @keyframes waveMove {
            0% {
              transform: scale(1.02) translateY(0px);
            }
            50% {
              transform: scale(1.03) translateY(-8px);
            }
            100% {
              transform: scale(1.02) translateY(6px);
            }
          }
        }
      `}</style>
    </div>
  )
}
