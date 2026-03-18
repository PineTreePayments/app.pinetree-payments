"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { getSolanaBalance, getEthereumBalance } from "@/lib/walletBalances"

/* =========================
TYPES
========================= */

type Wallet = {
  id:string
  network:string
  provider:string | null
  wallet_address:string
  balance?:number
}

/* =========================
FORMAT PROVIDER NAME
========================= */

function formatProvider(name?: string | null, network?: string){

  const map:any = {
    phantom: "Phantom",
    solflare: "Solflare",
    metamask: "MetaMask",
    trust: "Trust Wallet",
    coinbase: "Coinbase Wallet",
    base: "Base Wallet"
  }

  if(name && map[name]) return map[name]

  if(network === "solana") return "Phantom"
  if(network === "base") return "Base Wallet"
  if(network === "ethereum") return "MetaMask"

  return "Connected"
}

/* =========================
PAGE
========================= */

export default function WalletsPage(){

  const [wallets,setWallets] = useState<Wallet[]>([])
  const [totalBalance,setTotalBalance] = useState(0)

  useEffect(()=>{
    loadAll()
  },[])

  async function loadAll(){

    const { data:{ user } } = await supabase.auth.getUser()
    if(!user) return

    const { data: walletRows } = await supabase
      .from("merchant_wallets")
      .select("*")
      .eq("merchant_id",user.id)

    let total = 0

    const solPrice = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
    )
      .then(res => res.json())
      .then(d => d?.solana?.usd || 0)
      .catch(()=>0)

    const enriched = await Promise.all(
      (walletRows || []).map(async(w)=>{

        let balance = 0

        try{
          if(w.network === "solana"){
            balance = await getSolanaBalance(w.wallet_address)
            total += balance * solPrice
          } else {
            balance = await getEthereumBalance(w.wallet_address)
            total += balance * 3000
          }
        }catch{}

        return {...w, balance}
      })
    )

    setWallets(enriched)
    setTotalBalance(total)
  }

  /* =========================
UI
========================= */

  return(
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

          {wallets.map(w=>(
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
                  {w.balance ?? 0}
                </p>
              </div>

            </div>
          ))}

        </div>

      </div>

    </div>
  )
}