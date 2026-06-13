"use client"

import PineTree from "@pinetree/js"
import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type ReactNode,
} from "react"

export type PineTreeProviderProps = {
  publicKey: string
  baseUrl?: string
  children?: ReactNode
}

const PineTreeContext = createContext<PineTree | null>(null)

export function PineTreeProvider({
  publicKey,
  baseUrl,
  children,
}: PineTreeProviderProps) {
  const client = useMemo(
    () => new PineTree({ publicKey, baseUrl }),
    [baseUrl, publicKey]
  )
  return createElement(PineTreeContext.Provider, { value: client }, children)
}

export function usePineTreeContext(): PineTree {
  const client = useContext(PineTreeContext)
  if (!client) {
    throw new Error(
      "usePineTree() must be used inside a <PineTreeProvider>."
    )
  }
  return client
}
