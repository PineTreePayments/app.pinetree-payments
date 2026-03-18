"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getSolanaBalance, getEthereumBalance } from "@/lib/walletBalances"

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer
} from "recharts"

export default function DashboardPage() {

  const router = useRouter()

  const [volume,setVolume] = useState(0)
  const [txCount,setTxCount] = useState(0)
  const [successRate,setSuccessRate] = useState(0)
  const [providers,setProviders] = useState(0)
  const [recentTx,setRecentTx] = useState<any[]>([])
  const [chartData,setChartData] = useState<any[]>([])

  const [walletValue,setWalletValue] = useState(0)

  useEffect(()=>{

    async function loadStats(){

      const { data:{ user } } = await supabase.auth.getUser()
      if(!user) return


      /* LOAD TRANSACTIONS */

      const { data: tx } = await supabase
      .from("transactions")
      .select(`
        id,
        status,
        network,
        created_at,
        payments (
          subtotal_amount
        )
      `)
      .eq("merchant_id", user.id)
      .order("created_at",{ ascending:false })

      if(tx){

        const totalTx = tx.length

        const successTx = tx.filter(
          (t:any)=>t.status === "CONFIRMED"
        )

        const totalVolume = tx.reduce((sum:number,t:any)=>{

          const payment = Array.isArray(t.payments)
            ? t.payments[0]
            : t.payments

          return sum + Number(payment?.subtotal_amount ?? 0)

        },0)

        setTxCount(totalTx)
        setVolume(totalVolume)

        if(totalTx > 0){
          setSuccessRate(
            Math.round((successTx.length / totalTx) * 100)
          )
        }

        setRecentTx(tx.slice(0,10))


        /* CHART DATA */

        const map:any = {}

        tx.forEach((t:any)=>{

          const payment = Array.isArray(t.payments)
            ? t.payments[0]
            : t.payments

          const date =
            new Date(t.created_at).toLocaleDateString()

          if(!map[date]){
            map[date] = 0
          }

          map[date] += Number(payment?.subtotal_amount ?? 0)

        })

        const formatted =
          Object.keys(map).map((date)=>({
            date,
            volume: map[date]
          }))

        setChartData(formatted.reverse())

      }


      /* CONNECTED PROVIDERS */

      const { count } = await supabase
      .from("merchant_providers")
      .select("*",{ count:"exact", head:true })
      .eq("merchant_id", user.id)
      .eq("status","connected")

      setProviders(count ?? 0)


      /* LOAD WALLET BALANCES */

      const { data: wallets } = await supabase
      .from("merchant_wallets")
      .select("*")
      .eq("merchant_id",user.id)

      if(wallets){

        let sol = 0
        let eth = 0

        for(const w of wallets){

          if(w.network === "solana"){
            const bal = await getSolanaBalance(w.wallet_address)
            sol += bal
          }

          if(w.network === "base" || w.network === "ethereum"){
            const bal = await getEthereumBalance(w.wallet_address)
            eth += bal
          }

        }

        const estimatedValue =
          sol * 150 +
          eth * 3000

        setWalletValue(estimatedValue)

      }

    }

    loadStats()

  },[])



  return (

    <div className="p-8 bg-gray-100 min-h-screen">

      <h1 className="text-2xl font-semibold text-gray-900 mb-8">
        Overview
      </h1>


      {/* WALLET TREASURY CARD */}

      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm mb-10 flex justify-between items-center">

        <div>

          <p className="text-sm text-gray-500 mb-1">
            Wallet Balance
          </p>

          <p className="text-3xl font-semibold text-gray-900">
            ${walletValue.toFixed(2)}
          </p>

          <p className="text-sm text-gray-500 mt-1">
            Combined balance across connected wallets
          </p>

        </div>

        <button
          onClick={()=>router.push("/dashboard/wallets")}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
        >
          View Wallets
        </button>

      </div>



      {/* ANALYTICS */}

      <div className="grid grid-cols-4 gap-6 mb-10">

        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">

          <p className="text-sm text-gray-500 mb-1">
            Total Volume
          </p>

          <p className="text-3xl font-semibold text-gray-900">
            ${volume.toFixed(2)}
          </p>

        </div>


        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">

          <p className="text-sm text-gray-500 mb-1">
            Transactions
          </p>

          <p className="text-3xl font-semibold text-gray-900">
            {txCount}
          </p>

        </div>


        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">

          <p className="text-sm text-gray-500 mb-1">
            Success Rate
          </p>

          <p className="text-3xl font-semibold text-gray-900">
            {successRate}%
          </p>

        </div>


        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">

          <p className="text-sm text-gray-500 mb-1">
            Active Providers
          </p>

          <p className="text-3xl font-semibold text-gray-900">
            {providers}
          </p>

        </div>

      </div>



      {/* TRANSACTION GRAPH */}

      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm mb-10">

        <h2 className="text-lg font-semibold text-gray-900 mb-6">
          Transaction Volume
        </h2>

        <div className="h-64">

          <ResponsiveContainer width="100%" height="100%">

            <LineChart
              data={
                chartData.length > 0
                ? chartData
                : [
                  { date:"", volume:0 },
                  { date:"", volume:0 }
                ]
              }
            >

              <XAxis
                dataKey="date"
                tick={{ fill:"#6b7280", fontSize:12 }}
                axisLine={false}
                tickLine={false}
              />

              <YAxis
                tick={{ fill:"#6b7280", fontSize:12 }}
                axisLine={false}
                tickLine={false}
              />

              <Tooltip />

              <Line
                type="monotone"
                dataKey="volume"
                stroke="#2563eb"
                strokeWidth={3}
                dot={false}
              />

            </LineChart>

          </ResponsiveContainer>

        </div>

      </div>



      {/* RECENT ACTIVITY */}

      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">

        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Recent Activity
        </h2>

        {recentTx.length === 0 && (

          <div className="text-gray-500 text-sm">
            No transactions yet.
          </div>

        )}

        {recentTx.length > 0 && (

          <div className="overflow-x-auto">

            <table className="w-full text-sm">

              <thead className="text-left text-gray-500 border-b">

                <tr>
                  <th className="py-2">Transaction</th>
                  <th className="py-2">Amount</th>
                  <th className="py-2">Network</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Time</th>
                </tr>

              </thead>

              <tbody>

                {recentTx.map((tx)=>{

                  const payment = Array.isArray(tx.payments)
                    ? tx.payments[0]
                    : tx.payments

                  const statusColor =
                  tx.status === "CONFIRMED"
                    ? "text-green-600"
                    : tx.status === "FAILED"
                    ? "text-red-600"
                    : "text-yellow-600"

                  return(

                    <tr
                      key={tx.id}
                      className="border-b last:border-none"
                    >

                      <td className="py-3 font-mono text-xs text-gray-700">
                        {tx.id.slice(0,12)}...
                      </td>

                      <td className="py-3">
                        ${Number(payment?.subtotal_amount ?? 0).toFixed(2)}
                      </td>

                      <td className="py-3">
                        {tx.network ?? "-"}
                      </td>

                      <td className={`py-3 font-medium ${statusColor}`}>
                        {tx.status}
                      </td>

                      <td className="py-3 text-gray-500 text-xs">
                        {new Date(tx.created_at).toLocaleString()}
                      </td>

                    </tr>

                  )

                })}

              </tbody>

            </table>

          </div>

        )}

      </div>

    </div>

  )

}