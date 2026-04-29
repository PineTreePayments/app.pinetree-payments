"use client"

type Props = { children: React.ReactNode }

export default function SolanaWalletProvider({ children }: Props) {
  return <>{children}</>
}
