"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"
import { Eye, EyeOff } from "lucide-react"

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
      console.info("[auth:login] initial session check", {
        hasSession: Boolean(data.session),
        userId: data.session?.user?.id || null,
        cookieNames: document.cookie
          .split(";")
          .map((cookie) => cookie.trim().split("=")[0])
          .filter((name) => name.startsWith("sb-") || name.includes("auth"))
      })
      if (data.session) {
        window.location.href = "/dashboard"
      }
    }

    checkSession()

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.info("[auth:login] auth state change", {
        event,
        hasSession: Boolean(session),
        userId: session?.user?.id || null
      })
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

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    console.log("LOGIN RESULT:", { data, error })

    if (error) {
      setErrorMsg("Invalid email or password")
      toast.error("Invalid email or password")
      setLoading(false)
      return
    }

    const { data: sessionCheck } = await supabase.auth.getSession()
    console.info("[auth:login] session after login", {
      hasSession: Boolean(sessionCheck.session),
      userId: sessionCheck.session?.user?.id || null,
      expiresAt: sessionCheck.session?.expires_at || null,
      cookieNames: document.cookie
        .split(";")
        .map((cookie) => cookie.trim().split("=")[0])
        .filter((name) => name.startsWith("sb-") || name.includes("auth"))
    })

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

    console.log("SIGNUP RESULT:", { data, error })

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
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Animated Background */}
      <div className="absolute inset-0 bg-cover bg-center wave-bg"></div>

      {/* Login Card */}
      <div className="relative z-10 w-full max-w-md bg-white/90 backdrop-blur-xl shadow-xl rounded-xl p-6">
        <div className="flex justify-center mb-4">
          <Image
            src="/pinetree-web-logo.png"
            alt="PineTree"
            width={95}
            height={36}
          />
        </div>

        <h2 className="text-lg font-semibold text-gray-900 mb-4 text-center">
          {mode === "login"
            ? "Sign in to PineTree"
            : "Create your PineTree account"}
        </h2>

        {/* GOOGLE BUTTON (TOGGLED) */}
        {ENABLE_GOOGLE && (
          <>
            <button
              onClick={googleLogin}
              className="w-full border border-gray-300 rounded-md py-2.5 flex items-center justify-center gap-3 hover:bg-gray-50 transition"
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

        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email"
            className="border border-gray-300 p-2.5 rounded-md w-full mb-2 text-gray-900"
            onChange={(e) => setEmail(e.target.value)}
          />

          {mode === "signup" && (
            <input
              type="text"
              placeholder="Business name"
              className="border border-gray-300 p-2.5 rounded-md w-full mb-2 text-gray-900"
              onChange={(e) => setBusiness(e.target.value)}
            />
          )}

          <div className="relative mb-3">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              className="border border-gray-300 p-2.5 rounded-md w-full pr-10 text-gray-900"
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {errorMsg && (
            <p className="text-sm text-red-600 mb-3">{errorMsg}</p>
          )}

          {infoMsg && (
            <p className="text-sm text-blue-600 mb-3">{infoMsg}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-md transition font-medium disabled:opacity-60 disabled:cursor-not-allowed"
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

        <p className="text-xs text-gray-600 mt-4 text-center">
          {mode === "login" ? (
            <>
              New to PineTree?{" "}
              <button
                onClick={() => { setMode("signup"); setErrorMsg(""); setInfoMsg("") }}
                className="text-blue-600 font-medium"
              >
                Create account
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => { setMode("login"); setErrorMsg(""); setInfoMsg("") }}
                className="text-blue-600 font-medium"
              >
                Sign in
              </button>
            </>
          )}
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
      `}</style>
    </div>
  )
}
