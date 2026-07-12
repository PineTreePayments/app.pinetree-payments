"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import Link from "next/link"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"

/* =============================
TOGGLE GOOGLE SIGNUP HERE
============================= */

const ENABLE_GOOGLE = false

export default function SignupPage() {
  const router = useRouter()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")

  /* =============================
  AUTO REDIRECT + AUTH LISTENER (FIX)
  ============================= */

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()

      if (session) {
        router.replace("/dashboard")
      }
    }

    checkSession()

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        router.replace("/dashboard")
      }
    })

    return () => subscription.unsubscribe()
  }, [router])

  /* =============================
  SIGNUP HANDLER (FIXED)
  ============================= */

  async function handleSignup() {
    setLoading(true)
    setMessage("")

    const { data, error } = await supabase.auth.signUp({
      email,
      password
    })

    if (error) {
      setLoading(false)
      setMessage(error.message)
      return
    }

    if (data.session) {
      // Email confirmation is disabled — session is live.
      // The onAuthStateChange listener above will fire and call router.replace("/dashboard").
      // Keep loading=true so the button stays disabled while navigation happens.
      return
    }

    // Email confirmation is required — no session yet.
    setLoading(false)
    setMessage("Account created. Check your email to confirm, then sign in.")
  }

  /* -----------------------------
  GOOGLE SIGNUP (SAFE TO KEEP)
  ----------------------------- */

  async function handleGoogle() {
    const redirectUrl =
      process.env.NODE_ENV === "development"
        ? "http://localhost:3000/dashboard"
        : "https://app.pinetree-payments.com/dashboard"

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirectUrl
      }
    })

    if (error) {
      console.error("Google login error:", error.message)
      alert(error.message)
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-6 sm:min-h-screen sm:px-0 sm:py-0">
      <div className="absolute inset-0 h-[100dvh] bg-cover bg-center sm:h-auto wave-bg"></div>

      <div className="relative z-10 w-full max-w-[380px] rounded-xl bg-white/90 p-6 shadow-xl backdrop-blur-xl sm:p-8">
        <div className="mb-4 flex justify-center">
          <Image
            src="/pinetree-web-logo.png"
            alt="PineTree"
            width={95}
            height={36}
          />
        </div>

        <h1 className="mb-6 text-center text-2xl font-semibold text-gray-900">
          Create PineTree Account
        </h1>

        {/* GOOGLE BUTTON (TOGGLED) */}
        {ENABLE_GOOGLE && (
          <>
            <button
              onClick={handleGoogle}
              className="w-full border py-2 rounded mb-4 flex items-center justify-center gap-2 hover:bg-gray-50"
            >
              Continue with Google
            </button>

            <div className="flex items-center my-4">
              <div className="flex-1 h-px bg-gray-200"></div>
              <span className="px-2 text-sm text-gray-400">OR</span>
              <div className="flex-1 h-px bg-gray-200"></div>
            </div>
          </>
        )}

        <input
          type="email"
          autoComplete="email"
          className="mb-4 w-full rounded-md border border-gray-300 p-2.5 text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          placeholder="Email"
          value={email}
          onChange={(e)=>setEmail(e.target.value)}
        />

        <input
          type="password"
          autoComplete="new-password"
          className="mb-3 w-full rounded-md border border-gray-300 p-2.5 text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          placeholder="Password"
          value={password}
          onChange={(e)=>setPassword(e.target.value)}
        />

        <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2.5 text-xs leading-5 text-blue-900">
          <p className="font-semibold">Password must:</p>
          <ul className="mt-1 space-y-0.5">
            <li>• Be at least 11 characters</li>
            <li>• Include one uppercase letter</li>
            <li>• Include one lowercase letter</li>
            <li>• Include one number</li>
          </ul>
        </div>

        <button
          onClick={handleSignup}
          disabled={loading}
          className="w-full rounded-md bg-blue-600 py-2.5 font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
        >
          {loading ? "Creating..." : "Create Account"}
        </button>

        {message && (
          <p className="mt-4 text-sm text-center text-gray-700">
            {message}
          </p>
        )}

        <p className="mt-4 text-center text-xs text-gray-600">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-blue-600 transition hover:text-blue-700">
            Sign in
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
