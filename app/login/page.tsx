"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

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

  const router = useRouter()

  /* -----------------------------
  AUTO REDIRECT IF LOGGED IN
  + AUTH LISTENER (FIX)
  ----------------------------- */

  useEffect(() => {
    async function checkSession() {
      const { data } = await supabase.auth.getSession()

      if (data.session) {
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

  /* -----------------------------
  LOGIN (FIXED)
  ----------------------------- */

  async function login() {
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (error) {
      toast.error("Invalid email or password")
      setLoading(false)
      return
    }

    toast.success("Welcome back")

    // 🔥 FORCE REDIRECT (DO NOT RELY ON session)
    router.replace("/dashboard")
  }

  /* -----------------------------
  SIGNUP
  ----------------------------- */

  async function signup() {
    if (!business) {
      toast.error("Please enter a business name")
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          business_name: business
        }
      }
    })

    if (error) {
      toast.error(error.message)
      setLoading(false)
      return
    }

    toast.success("Account created. Please sign in.")
    setMode("login")
    setLoading(false)
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
              <img
                src="https://www.svgrepo.com/show/475656/google-color.svg"
                width="20"
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

        <input
          type="password"
          placeholder="Password"
          className="border border-gray-300 p-2.5 rounded-md w-full mb-3 text-gray-900"
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          onClick={mode === "login" ? login : signup}
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

        <p className="text-xs text-gray-600 mt-4 text-center">
          {mode === "login" ? (
            <>
              New to PineTree?{" "}
              <button
                onClick={() => setMode("signup")}
                className="text-blue-600 font-medium"
              >
                Create account
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => setMode("login")}
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