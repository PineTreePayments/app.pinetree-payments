"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import Link from "next/link"
import AuthFrame from "@/components/ui/AuthFrame"

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
    <AuthFrame
      title="Create your account"
      subtitle="Open a PineTree merchant workspace and connect payment methods when you are ready."
    >

        {/* GOOGLE BUTTON (TOGGLED) */}
        {ENABLE_GOOGLE && (
          <>
            <button
              onClick={handleGoogle}
              className="mb-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-2 hover:bg-gray-50"
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

        <div className="space-y-3">
          <input
            className="form-field"
            type="email"
            aria-label="Email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e)=>setEmail(e.target.value)}
          />

          <input
            type="password"
            className="form-field"
            aria-label="Password"
            autoComplete="new-password"
            placeholder="Password"
            value={password}
            onChange={(e)=>setPassword(e.target.value)}
          />

          <button
            onClick={handleSignup}
            disabled={loading}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#1652f0] px-4 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(22,82,240,0.22)] transition hover:-translate-y-0.5 hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? "Creating..." : "Create Account"}
          </button>
        </div>

        {message && (
          <p role="status" className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-center text-sm text-blue-700">
            {message}
          </p>
        )}
        <p className="mt-5 text-center text-sm text-gray-600">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-blue-600 hover:text-blue-700">
            Sign in
          </Link>
        </p>
    </AuthFrame>
  )
}
