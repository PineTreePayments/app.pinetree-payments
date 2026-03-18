"use client"

import { Suspense } from "react"
import SolanaReturnInner from "./SolanaReturnInner"

export default function SolanaReturnPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center bg-white">
          <p className="text-black text-sm">Connecting wallet...</p>
        </div>
      }
    >
      <SolanaReturnInner />
    </Suspense>
  )
}