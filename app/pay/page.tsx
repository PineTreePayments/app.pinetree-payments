import { Suspense } from "react"
import PayClient from "./PayClient"
import { Web3Provider } from "@/components/providers/Web3Provider"

export const dynamic = "force-dynamic"

export default function PayPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-xl shadow p-6 text-center">
            <h1 className="text-xl font-semibold mb-2">Loading payment…</h1>
          </div>
        </main>
      }
    >
      <Web3Provider>
        <PayClient />
      </Web3Provider>
    </Suspense>
  )
}
