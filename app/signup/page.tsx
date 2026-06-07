"use client"

import { useState, useEffect } from "react"
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
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">

      <div className="bg-white p-6 sm:p-8 rounded-lg shadow w-full max-w-[380px]">

        <h1 className="text-2xl font-semibold mb-6 text-center">
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
          className="w-full border p-2 mb-4 rounded"
          placeholder="Email"
          value={email}
          onChange={(e)=>setEmail(e.target.value)}
        />

        <input
          type="password"
          className="w-full border p-2 mb-4 rounded"
          placeholder="Password"
          value={password}
          onChange={(e)=>setPassword(e.target.value)}
        />

        <button
          onClick={handleSignup}
          disabled={loading}
          className="w-full bg-black text-white py-2 rounded disabled:opacity-60"
        >
          {loading ? "Creating..." : "Create Account"}
        </button>

        {message && (
          <p className="mt-4 text-sm text-center text-gray-700">
            {message}
          </p>
        )}

      </div>

    </div>
  )
}