"use client"

import { FormEvent, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { supabase } from "@/lib/supabaseClient"

function getResetRedirectUrl() {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (typeof window !== "undefined" ? window.location.origin : "")
  return `${appUrl.replace(/\/$/, "")}/reset-password`
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  const [successMsg, setSuccessMsg] = useState("")

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMsg("")
    setSuccessMsg("")

    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setErrorMsg("Enter the email connected to your PineTree account.")
      return
    }
    if (!isValidEmail(trimmedEmail)) {
      setErrorMsg("Enter a valid email address.")
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo: getResetRedirectUrl()
    })
    setLoading(false)

    if (error) {
      setErrorMsg(
        process.env.NODE_ENV === "development"
          ? error.message
          : "We could not send a reset link right now. Please try again."
      )
      return
    }

    setSuccessMsg("If an account exists for that email, a password reset link has been sent.")
  }

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-6 sm:min-h-screen sm:px-0 sm:py-0">
      <div className="absolute inset-0 h-[100dvh] bg-cover bg-center sm:h-auto wave-bg"></div>

      <div className="relative z-10 w-full max-w-md rounded-xl bg-white/90 p-6 shadow-xl backdrop-blur-xl">
        <div className="mb-4 flex justify-center">
          <Image src="/pinetree-web-logo.png" alt="PineTree" width={95} height={36} />
        </div>

        <h1 className="mb-2 text-center text-lg font-semibold text-gray-900">
          Reset your password
        </h1>
        <p className="mb-5 text-center text-sm text-gray-600">
          Enter the email connected to your PineTree account and we&apos;ll send you a reset link.
        </p>

        <form onSubmit={handleSubmit}>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="mb-3 w-full rounded-md border border-gray-300 p-2.5 text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />

          {errorMsg && <p className="mb-3 text-sm text-red-600">{errorMsg}</p>}
          {successMsg && <p className="mb-3 text-sm text-blue-600">{successMsg}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-blue-600 py-2.5 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Sending..." : "Send reset link"}
          </button>
        </form>

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
