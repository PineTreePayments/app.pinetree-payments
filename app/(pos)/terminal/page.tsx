"use client"

import { Suspense } from "react"
import TerminalInner from "./TerminalInnerr"

export default function TerminalPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center">
          Loading...
        </div>
      }
    >
      <TerminalInner />
    </Suspense>
  )
}