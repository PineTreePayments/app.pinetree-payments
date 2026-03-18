"use client"

import { useState } from "react"
import { supabase } from "@/lib/database/supabase"
import { useRouter } from "next/navigation"

export default function SignupPage() {
  const router = useRouter()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSignup() {
    setLoading(true)

    const { error } = await supabase.auth.signUp({
      email,
      password
    })

    setLoading(false)

    if (error) {
      alert(error.message)
      return
    }

    router.push("/dashboard")
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-100">

      <div className="bg-white p-8 rounded-lg shadow w-[380px]">

        <h1 className="text-2xl font-semibold mb-6">
          Create PineTree Account
        </h1>

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
