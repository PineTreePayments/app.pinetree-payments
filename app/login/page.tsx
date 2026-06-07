"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"
import { Eye, EyeOff } from "lucide-react"
import AuthFrame from "@/components/ui/AuthFrame"

/* =============================
TOGGLE GOOGLE LOGIN HERE
============================= */

const ENABLE_GOOGLE = false

export default function LoginPage() {
  const [mode, setMode] = useState("login")
  const [email, setEmail] = useState("")
  const [business, setBusiness] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  const [infoMsg, setInfoMsg] = useState("")

  /* -----------------------------
  AUTO REDIRECT IF LOGGED IN
  ----------------------------- */

  useEffect(() => {
    async function checkSession() {
      const { data } = await supabase.auth.getSession()
      if (data.session) {
        window.location.href = "/dashboard"
      }
    }

    checkSession()

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        window.location.href = "/dashboard"
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  /* -----------------------------
  LOGIN
  ----------------------------- */

  async function handleLogin() {
    setLoading(true)
    setErrorMsg("")
    setInfoMsg("")

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (error) {
      setErrorMsg("Invalid email or password")
      toast.error("Invalid email or password")
      setLoading(false)
      return
    }

    toast.success("Welcome back")
    window.location.href = "/dashboard"
  }

  /* -----------------------------
  SIGNUP
  ----------------------------- */

  async function handleSignup() {
    setErrorMsg("")
    setInfoMsg("")

    if (!business) {
      setErrorMsg("Please enter a business name")
      toast.error("Please enter a business name")
      return
    }

    setLoading(true)

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          business_name: business
        }
      }
    })

    if (error) {
      setErrorMsg(error.message)
      toast.error(error.message)
      setLoading(false)
      return
    }

    if (data.session) {
      toast.success("Account created. Welcome!")
      window.location.href = "/dashboard"
      return
    }

    setInfoMsg("Check your email to confirm your account")
    toast.success("Check your email to confirm your account")
    setLoading(false)
  }

  /* -----------------------------
  FORM SUBMIT
  ----------------------------- */

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (mode === "login") {
      handleLogin()
    } else {
      handleSignup()
    }
  }

  /* -----------------------------
  GOOGLE LOGIN (SAFE TO KEEP)
  ----------------------------- */

  async function googleLogin() {
    const redirectUrl =
      process.env.NODE_ENV === "development"
        ? "http://localhost:3000"
        : "https://app.pinetree-payments.com"

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirectUrl
      }
    })

    if (error) {
      toast.error(error.message)
    }
  }

  /* -----------------------------
  UI
  ----------------------------- */

  return (
    <AuthFrame
      title={mode === "login" ? "Welcome back" : "Create your account"}
      subtitle={mode === "login"
        ? "Sign in to manage payments, wallets, reports, and point-of-sale."
        : "Set up a secure PineTree merchant workspace."}
    >

        {/* GOOGLE BUTTON (TOGGLED) */}
        {ENABLE_GOOGLE && (
          <>
            <button
              onClick={googleLogin}
              className="flex min-h-11 w-full items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white py-2.5 transition hover:bg-gray-50"
            >
              <Image
                src="https://www.svgrepo.com/show/475656/google-color.svg"
                width={20}
                height={20}
                alt="Google"
              />

              <span className="text-gray-900 font-medium">
                Continue with Google
              </span>
            </button>

            <div className="flex items-center my-4">
              <div className="flex-grow border-t border-gray-300"></div>
              <span className="mx-4 text-xs text-gray-500">OR</span>
              <div className="flex-grow border-t border-gray-300"></div>
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            aria-label="Email"
            autoComplete="email"
            required
            className="form-field"
            onChange={(e) => setEmail(e.target.value)}
          />

          {mode === "signup" && (
            <input
              type="text"
              placeholder="Business name"
              aria-label="Business name"
              autoComplete="organization"
              className="form-field"
              onChange={(e) => setBusiness(e.target.value)}
            />
          )}

          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              aria-label="Password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              className="form-field pr-11"
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {errorMsg && (
            <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMsg}</p>
          )}

          {infoMsg && (
            <p className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">{infoMsg}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#1652f0] px-4 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(22,82,240,0.22)] transition hover:-translate-y-0.5 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading
              ? mode === "login"
                ? "Signing in..."
                : "Creating account..."
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-gray-600">
          {mode === "login" ? (
            <>
              New to PineTree?{" "}
              <button
                onClick={() => { setMode("signup"); setErrorMsg(""); setInfoMsg("") }}
                className="font-semibold text-blue-600 hover:text-blue-700"
              >
                Create account
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => { setMode("login"); setErrorMsg(""); setInfoMsg("") }}
                className="font-semibold text-blue-600 hover:text-blue-700"
              >
                Sign in
              </button>
            </>
          )}
        </p>
    </AuthFrame>
  )
}
