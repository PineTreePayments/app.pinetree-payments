"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/database/supabase"
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

  /* =============================
  AUTO REDIRECT IF SESSION EXISTS
  ============================= */

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()

      if (session) {
        router.push("/dashboard")
      }
    }

    checkSession()
  }, [router])

  /* =============================
  SIGNUP HANDLER
  ============================= */

  async function handleSignup() {
    setLoading(true)

    const { data, error } = await supabase.auth.signUp({
      email,
      password
    })

    if (error) {
      setLoading(false)
      alert(error.message)
      return
    }

    /* =============================
    HANDLE SESSION CORRECTLY
    ============================= */

    const session = data.session

    if (session) {
      // Email confirm OFF → instant login
      router.push("/dashboard")
    } else {
      // Email confirm ON → user must verify email
      alert("Check your email to confirm your account")
    }

    setLoading(false)
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
          className="w-full bg-black text-white py-2 rounded"
        >
          {loading ? "Creating..." : "Create Account"}
        </button>

      </div>

    </div>
  )
}