"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import POSLayout from "@/components/pos/POSLayout"
import Keypad from "@/components/pos/Keypad"
import { supabase } from "@/lib/supabaseClient"

type Toast = {
  id: number
  message: string
  type: "success" | "error"
}

type Terminal = {
  id: string
  name: string
  pin: string
  autolock: string
  merchant_id?: string
}

export default function TerminalInner() {

  const router = useRouter()
  const params = useSearchParams()

  const terminalId = params.get("tid")

  const [terminal,setTerminal] = useState<Terminal | null>(null)
  const [unlockMode,setUnlockMode] = useState(false)
  const [digits,setDigits] = useState("")
  const [toasts,setToasts] = useState<Toast[]>([])

  function showToast(message:string,type:"success"|"error"){

    const id = Date.now()

    setToasts(prev => [...prev,{id,message,type}])

    setTimeout(()=>{
      setToasts(prev => prev.filter(t => t.id !== id))
    },3000)

  }

  useEffect(()=>{

    async function loadTerminal(){

      if(!terminalId) return

      const { data, error } = await supabase
        .from("terminals")
        .select("*")
        .eq("id",terminalId)
        .single()

      if(error){
        console.error(error)
        return
      }

      if(data){

        setTerminal(data)

        localStorage.setItem(
          "pinetree_terminal",
          JSON.stringify({
            terminalId:data.id,
            merchantId:data.merchant_id,
            provider:"coinbase"
          })
        )

      }

    }

    loadTerminal()

  },[terminalId])

  useEffect(()=>{

    if(digits.length !== 4 || !terminal) return

    if(digits === terminal.pin){

      showToast("Terminal unlocked","success")

      setTimeout(()=>{
        router.push("/dashboard/pos")
      },700)

    }else{

      showToast("Incorrect PIN","error")
      setDigits("")

    }

  },[digits,terminal,router])

  function requestUnlock(){
    setUnlockMode(true)
    setDigits("")
  }

  function cancelUnlock(){
    setUnlockMode(false)
    setDigits("")
  }

  return (

    <div className="h-screen w-screen bg-gray-100 flex items-center justify-center relative">

      {terminal && unlockMode && (

        <div className="absolute top-6 left-1/2 -translate-x-1/2 text-center">

          <div className="text-sm text-gray-600 font-medium">
            POS {terminal.id}
          </div>

        </div>

      )}

      <div className="fixed right-6 top-24 space-y-3 z-50">

        {toasts.map((toast)=>(
          <div
            key={toast.id}
            className={`px-4 py-3 rounded-md shadow-lg text-white text-sm font-medium ${
              toast.type === "success"
                ? "bg-green-600"
                : "bg-red-600"
            }`}
          >
            {toast.message}
          </div>
        ))}

      </div>

      <button
        onClick={requestUnlock}
        className="absolute top-6 right-6 hover:scale-110 transition"
      >

        <svg width="34" height="34" viewBox="0 0 24 24" fill="none">

          <rect x="6" y="10" width="12" height="10" rx="2" fill="#0052FF"/>

          <path
            d="M8 10V7a4 4 0 118 0v3"
            stroke="#0052FF"
            strokeWidth="2"
            strokeLinecap="round"
          />

        </svg>

      </button>

      {!unlockMode && (
        <POSLayout locked={false} />
      )}

      {unlockMode && (

        <div className="bg-white shadow-xl rounded-2xl p-12 w-[420px]">

          <div className="text-center mb-8">

            <div className="text-lg font-semibold text-black">
              Enter PIN
            </div>

            <div className="text-3xl tracking-widest mt-2">
              {"•".repeat(digits.length)}
            </div>

          </div>

          <Keypad
            digits={digits}
            setDigits={setDigits}
            maxLength={4}
          />

          <button
            onClick={cancelUnlock}
            className="mt-6 text-sm text-gray-500 hover:text-gray-700 w-full text-center"
          >
            Cancel
          </button>

        </div>

      )}

    </div>

  )

}