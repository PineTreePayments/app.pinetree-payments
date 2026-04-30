import type { ReactNode } from "react"
import { Web3Provider } from "@/components/providers/Web3Provider"

export default function PayLayout({ children }: { children: ReactNode }) {
  return <Web3Provider>{children}</Web3Provider>
}