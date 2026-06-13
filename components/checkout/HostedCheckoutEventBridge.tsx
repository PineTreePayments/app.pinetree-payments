"use client"

import { useEffect, useRef } from "react"
import {
  postHostedCheckoutEvent,
  type HostedCheckoutEventName,
} from "@/lib/checkout/hostedCheckoutEvents"

export default function HostedCheckoutEventBridge({
  sessionId,
  event,
  status,
}: {
  sessionId: string
  event: Exclude<HostedCheckoutEventName, "closed">
  status: string
}) {
  const emittedRef = useRef(false)

  useEffect(() => {
    if (emittedRef.current) return
    emittedRef.current = true
    postHostedCheckoutEvent(sessionId, event, status)
  }, [event, sessionId, status])

  return null
}
