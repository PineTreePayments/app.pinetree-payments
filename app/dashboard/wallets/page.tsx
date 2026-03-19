"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"

/* =========================
TYPES
========================= */

type WalletRow = {
  id: string
  network: string
  wallet_address: string
  wallet_type?: string | null
  provider?: string | null
}

type BalanceRow = {
  asset: string
  balance: number | string | null
}

type Wallet = {
  id: string
  network: string
  provider: string | null
  wallet_address: string
  balance?: number
}

/* =========================
FORMAT PROVIDER NAME
========================= */

function formatProvider(name?: string | null, network?: string) {
  const normalized = String(name || "").toLowerCase()

  const map: any = {
    phantom: "Phantom",
    solflare: "Solflare",
    metamask: "MetaMask",
    trust: "Trust Wallet",
    coinbase: "Coinbase Wallet",
    base: "Base Wallet",
    baseapp: "Base Wallet"
  }

  if (normalized && map[normalized]) return map[normalized]

  if (network === "solana") return "Phantom"
  if (network === "base") return "Base Wallet"
  if (network === "ethereum") return "MetaMask"

  return "Connected"
}

/* =========================
PAGE
========================= */

export default function WalletsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [totalBalance, setTotalBalance] = useState(0)

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: walletRows, error: walletError }, { data: balanceRows, error: balanceError }] =
      await Promise.all([
        supabase
          .from("merchant_wallets")
          .select("*")
          .eq("merchant_id", user.id),
        supabase
          .from("wallet_balances")
          .select("asset, balance")
          .eq("merchant_id", user.id)
      ])

    if (walletError) {
      console.error("merchant_wallets load error:", walletError)
      setWallets([])
      setTotalBalance(0)
      return
    }

    if (balanceError) {
      console.error("wallet_balances load error:", balanceError)
    }

    const balances = (balanceRows || []) as BalanceRow[]
    const walletsData = (walletRows || []) as WalletRow[]

    /* =========================
       NORMALIZE BALANCES
    ========================= */

    let solBalance = 0
    let ethBalance = 0

    for (const b of balances) {
      const asset = String(b.asset || "").toUpperCase()
      const value = Number(b.balance ?? 0) || 0

      if (asset === "SOL" || asset === "SOLANA") {
        solBalance = value
      }

      if (asset === "ETH" || asset === "ETHEREUM" || asset === "BASE") {
        ethBalance = value
      }
    }

    /* =========================
       GET PRICES
    ========================= */

    const prices = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana,ethereum&vs_currencies=usd"
    )
      .then((res) => res.json())
      .then((d) => ({
        sol: d?.solana?.usd || 0,
        eth: d?.ethereum?.usd || 0
      }))
      .catch(() => ({
        sol: 0,
        eth: 0
      }))

    /* =========================
       MERGE DATA
    ========================= */

    const enriched: Wallet[] = walletsData.map((w) => {
      let balance = 0

      if (w.network === "solana") {
        balance = solBalance
      }

      if (w.network === "base" || w.network === "ethereum") {
        balance = ethBalance
      }

      return {
        id: w.id,
        network: w.network,
        provider: w.provider || w.wallet_type || null,
        wallet_address: w.wallet_address,
        balance
      }
    })

    const total =
      solBalance * prices.sol +
      ethBalance * prices.eth

    setWallets(enriched)
    setTotalBalance(total)
  }

  /* =========================
  UI
  ========================= */

  return (
    <div className="w-full px-8 py-10">

      <h1 className="text-3xl font-semibold text-black mb-8">
        Wallets
      </h1>

      {/* TOTAL */}
      <div className="bg-white border border-gray-200 rounded-2xl p-8 mb-8 shadow-sm w-full">
        <p className="text-sm text-blue-600 mb-2">Total Balance</p>
        <p className="text-4xl font-semibold text-black">
          ${totalBalance.toFixed(2)}
        </p>
      </div>

      {/* CONNECTED */}
      <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm w-full">

        <h2 className="text-lg font-semibold text-black mb-6">
          Connected Wallets
        </h2>

        <div className="space-y-5">

          {wallets.length === 0 && (
            <p className="text-gray-400 text-sm">
              No wallets connected yet
            </p>
          )}

          {wallets.map((w) => (
            <div key={w.id} className="flex justify-between items-center border rounded-xl p-6 min-h-[90px]">

              {/* LEFT */}
              <div>
                <p className="text-sm text-blue-600 font-medium mb-1">
                  {formatProvider(w.provider, w.network)}
                </p>

                <p className="text-base font-semibold text-black break-all">
                  {w.wallet_address}
                </p>
              </div>

              {/* RIGHT */}
              <div className="text-right">
                <p className="text-sm text-blue-600 mb-1">
                  Balance
                </p>

                <p className="text-lg text-black font-semibold">
                  {Number(w.balance ?? 0).toFixed(6)}
                </p>
              </div>

            </div>
          ))}

        </div>

      </div>

    </div>
  )
}