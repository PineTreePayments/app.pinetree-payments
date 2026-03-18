"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/database/supabase"
import { Loader2, CheckCircle, XCircle } from "lucide-react"
import AmountDisplay from "./AmountDisplay"
import Keypad from "./Keypad"

type Props = {
  locked: boolean
}

type Status =
  | "ready"
  | "confirm"
  | "waiting"
  | "processing"
  | "confirmed"
  | "failed"

export default function POSLayout({ locked }: Props) {

  const [digits,setDigits] = useState("")
  const [connected,setConnected] = useState(false)
  const [status,setStatus] = useState<Status>("ready")
  const [paymentUrl,setPaymentUrl] = useState("")
  const [qrCodeUrl,setQrCodeUrl] = useState("")
  const [channel,setChannel] = useState<any>(null)

  /* TAX SETTINGS */

  const [taxEnabled,setTaxEnabled] = useState(false)
  const [taxRate,setTaxRate] = useState(0)

  const amount = (Number(digits || "0") / 100).toFixed(2)

  const taxAmount = taxEnabled
    ? (Number(amount) * (taxRate / 100)).toFixed(2)
    : "0.00"

  const total = (
    Number(amount) +
    Number(taxAmount)
  ).toFixed(2)

  /* LOAD TAX SETTINGS */

  useEffect(()=>{

    const providerStatus =
      localStorage.getItem("pinetree_provider_connected")

    setConnected(providerStatus === "true")

    loadTaxSettings()

  },[])

  async function loadTaxSettings(){

    try{

      const { data:{ user } } = await supabase.auth.getUser()

      if(!user) return

      const { data } = await supabase
        .from("merchant_tax_settings")
        .select("*")
        .eq("merchant_id",user.id)
        .single()

      if(data){

        setTaxEnabled(data.tax_enabled)
        setTaxRate(Number(data.tax_rate))

      }

    }catch(err){

      console.error("Failed loading tax settings:",err)

    }

  }

  function resetSale(){

    setDigits("")
    setStatus("ready")
    setPaymentUrl("")
    setQrCodeUrl("")

    if(channel){
      supabase.removeChannel(channel)
      setChannel(null)
    }

  }

  function listenForPayment(paymentId:string){

    const realtimeChannel = supabase
      .channel(`payment-${paymentId}`)
      .on(
        "postgres_changes",
        {
          event:"UPDATE",
          schema:"public",
          table:"payments",
          filter:`id=eq.${paymentId}`
        },
        (payload:any)=>{

          const newStatus = payload.new.status

          if(newStatus === "PROCESSING"){
            setStatus("processing")
          }

          if(newStatus === "CONFIRMED"){

            setStatus("confirmed")

            setTimeout(()=>{
              resetSale()
            },3500)

          }

          if(newStatus === "FAILED"){
            setStatus("failed")
          }

        }
      )
      .subscribe()

    setChannel(realtimeChannel)

  }

  async function createPayment(){

    if(!digits || Number(amount) <= 0){
      return
    }

    try{

      setStatus("waiting")

      const idempotencyKey = crypto.randomUUID()

      const terminal = JSON.parse(
        localStorage.getItem("pinetree_terminal") || "{}"
      )

      if(!terminal.provider){
        setStatus("failed")
        return
      }

      const res = await fetch("/api/payments/create",{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "idempotency-key": idempotencyKey
        },
        body:JSON.stringify({
          amount: total,   // TOTAL INCLUDING TAX
          currency:"USD",
          provider: terminal.provider,
          merchantId: terminal.merchantId,
          terminalId: terminal.terminalId,
          subtotal: amount,
          tax: taxAmount
        })
      })

      const data = await res.json()

      if(!data.paymentId){
        setStatus("failed")
        return
      }

      if(data.paymentUrl){
        setPaymentUrl(data.paymentUrl)
      }

      if(data.qrCodeUrl){
        setQrCodeUrl(data.qrCodeUrl)
      }

      listenForPayment(data.paymentId)

    }catch(err){

      console.error("Payment error:",err)
      setStatus("failed")

    }

  }

  return (

    <div className="flex flex-col items-center">

      <div className="text-center mb-4">

        {connected ? (
          <span className="text-green-600 text-sm font-medium">
            Connected
          </span>
        ) : (
          <span className="text-red-600 text-sm font-medium">
            Disconnected
          </span>
        )}

      </div>

      <div className="bg-white rounded-2xl shadow-lg p-8 w-[440px] max-w-full">

        {/* CONFIRM SCREEN */}

        {status === "confirm" && (

          <div className="text-center">

            <h2 className="text-lg font-semibold mb-6">
              Confirm Payment
            </h2>

            <div className="space-y-2 text-gray-700 mb-6">

              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>${amount}</span>
              </div>

              {taxEnabled && (
                <div className="flex justify-between">
                  <span>Tax</span>
                  <span>${taxAmount}</span>
                </div>
              )}

              <div className="border-t my-2"></div>

              <div className="flex justify-between font-semibold text-lg">
                <span>Total</span>
                <span>${total}</span>
              </div>

            </div>

            <div className="flex gap-4 justify-center">

              <button
                onClick={()=>setStatus("ready")}
                className="px-6 py-3 bg-gray-200 rounded-md"
              >
                Back
              </button>

              <button
                onClick={createPayment}
                className="px-6 py-3 bg-[#0052FF] text-white rounded-md"
              >
                Pay
              </button>

            </div>

          </div>

        )}

        {/* QR SCREEN */}

        {status === "waiting" && qrCodeUrl && (

          <div className="flex flex-col items-center py-8">

            <div className="text-sm text-gray-500 mb-3">
              Scan to Pay
            </div>

            <div className="bg-white p-4 rounded-xl shadow">

              <img
                src={qrCodeUrl}
                width={220}
                height={220}
                alt="Payment QR"
              />

            </div>

          </div>

        )}

        {/* PROCESSING */}

        {status === "processing" && (

          <div className="flex flex-col items-center py-12">

            <Loader2
              size={56}
              className="text-yellow-500 animate-spin"
            />

            <div className="mt-4 text-gray-600 font-medium">
              Processing Payment
            </div>

          </div>

        )}

        {/* SUCCESS */}

        {status === "confirmed" && (

          <div className="flex flex-col items-center py-10">

            <CheckCircle
              size={70}
              className="text-green-600"
            />

            <div className="mt-4 text-lg font-semibold text-green-600">
              Payment Confirmed
            </div>

          </div>

        )}

        {/* FAILED */}

        {status === "failed" && (

          <div className="flex flex-col items-center py-10">

            <XCircle
              size={70}
              className="text-red-600"
            />

            <div className="mt-4 text-lg font-semibold text-red-600">
              Payment Failed
            </div>

          </div>

        )}

        {/* AMOUNT ENTRY */}

        {status === "ready" && (

          <>
            <div className="mb-8 text-center">
              <AmountDisplay amount={amount} />
            </div>

            {!locked ? (

              <Keypad
                digits={digits}
                setDigits={setDigits}
              />

            ) : (

              <div className="text-center text-gray-400 text-lg py-20">
                Terminal Locked
              </div>

            )}

            {!locked && (

              <div className="flex justify-center mt-6">

                <button
                  onClick={()=>setStatus("confirm")}
                  className="w-[280px] bg-[#0052FF] text-white rounded-md py-3 font-semibold hover:opacity-90"
                >
                  Charge
                </button>

              </div>

            )}
          </>

        )}

      </div>

    </div>

  )

}