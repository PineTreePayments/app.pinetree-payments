"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import Link from "next/link"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"
import { Eye, EyeOff } from "lucide-react"

/* =============================
TOGGLE GOOGLE LOGIN HERE
============================= */

const ENABLE_GOOGLE = false

type ConditionalPublicKeyCredential = typeof PublicKeyCredential & {
  isConditionalMediationAvailable?: () => Promise<boolean>
}

export default function LoginPage() {
  const [mode, setMode] = useState("login")
  const [email, setEmail] = useState("")
  const [business, setBusiness] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  const [infoMsg, setInfoMsg] = useState("")
  const [passkeySupported, setPasskeySupported] = useState(false)
  const [conditionalPasskeySupported, setConditionalPasskeySupported] = useState(false)
  const [passkeyMsg, setPasskeyMsg] = useState("")

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
  PASSKEY SUPPORT DETECTION
  ----------------------------- */

  useEffect(() => {
    if (typeof window === "undefined" || !window.PublicKeyCredential) return

    setPasskeySupported(true)

    const credential = window.PublicKeyCredential as ConditionalPublicKeyCredential
    if (typeof credential.isConditionalMediationAvailable === "function") {
      void credential.isConditionalMediationAvailable()
        .then((available) => setConditionalPasskeySupported(Boolean(available)))
        .catch(() => setConditionalPasskeySupported(false))
    }
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
    setPasskeyMsg("")
    if (mode === "login") {
      handleLogin()
    } else {
      handleSignup()
    }
  }

  /* -----------------------------
  PASSKEY SIGN IN (OPTIONAL)
  ----------------------------- */

  async function handlePasskeySignIn() {
    setPasskeyMsg("")
    try {
      // TODO: Supabase passkey helpers are still experimental in the installed SDK types.
      // Keep manual passkey sign-in as the stable fallback until conditional mediation is typed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.auth as any).signInWithPasskey()
      if (error) {
        setPasskeyMsg("Passkey sign-in was cancelled.")
        return
      }
      window.location.href = "/dashboard"
    } catch {
      setPasskeyMsg("Passkey sign-in was cancelled.")
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
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-6 sm:min-h-screen sm:px-0 sm:py-0">
      {/* Animated Background */}
      <div className="absolute inset-0 h-[100dvh] bg-cover bg-center sm:h-auto wave-bg"></div>

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
            autoComplete={mode === "login" && conditionalPasskeySupported ? "username webauthn" : "email"}
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

          {mode === "login" && (
            <div className="mb-1 flex justify-end">
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-blue-600 transition hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                Forgot password?
              </Link>
            </div>
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

          {mode === "login" && passkeySupported && (
            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={handlePasskeySignIn}
                className="text-xs text-gray-400 underline underline-offset-2 transition hover:text-gray-600"
              >
                Use a passkey
              </button>
            </div>
          )}

          {passkeyMsg && (
            <p className="mt-1.5 text-center text-xs text-gray-400">{passkeyMsg}</p>
          )}
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
