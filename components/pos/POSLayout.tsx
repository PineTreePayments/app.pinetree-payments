"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { Loader2, CheckCircle, XCircle } from "lucide-react"
import QRCode from "qrcode"
import { supabase } from "@/lib/supabaseClient"
import AmountDisplay from "./AmountDisplay"
import Keypad from "./Keypad"

type Props = {
  locked: boolean
  terminalContext?: {
    merchantId: string
    terminalId?: string
    provider?: string
  } | null
}

type Status =
  | "ready"
  | "confirm"
  | "waiting"
  | "processing"
  | "confirmed"
  | "incomplete"
  | "failed"

export default function POSLayout({ locked, terminalContext }: Props) {

  const [digits,setDigits] = useState("")
  const [status,setStatus] = useState<Status>("ready")
  const [qrCodeUrl,setQrCodeUrl] = useState("")
  const [paymentId, setPaymentId] = useState("")
  const [paymentError, setPaymentError] = useState("")

  const subtotal = (Number(digits || "0") / 100).toFixed(2)

  function resetSale(){
    setDigits("")
    setStatus("ready")
    setQrCodeUrl("")
    setPaymentId("")
    setPaymentError("")
  }

  /* =========================
     REALTIME SUBSCRIPTION
  ========================= */

  useEffect(() => {
    if (!paymentId) return

    const channel = supabase
      .channel(`payment-${paymentId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "payments",
          filter: `id=eq.${paymentId}`
        },
        (payload) => {
          const statusRaw = payload.new.status?.toUpperCase()

          if (statusRaw === "PROCESSING") {
            setStatus("processing")
          }

          if (statusRaw === "CONFIRMED") {
            setStatus("confirmed")
            setTimeout(resetSale, 3000)
          }

          if (statusRaw === "FAILED") {
            setStatus("failed")
          }

          if (statusRaw === "INCOMPLETE") {
            setStatus("incomplete")
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [paymentId])

  /* =========================
     CREATE PAYMENT
  ========================= */

  async function createPayment(){

    if(!digits || Number(subtotal) <= 0){
      return
    }

    try{

      setStatus("waiting")

      const res = await fetch("/api/pos/payment",{
        method:"POST",
        headers:{
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          amount: Number(subtotal),
          currency:"USD",
          terminal: terminalContext
        })
      })

      const data = await res.json()

      if(!res.ok || !data){
        setPaymentError("Payment failed")
        setStatus("failed")
        return
      }

      if(data.paymentUrl){
        const qr = await QRCode.toDataURL(data.paymentUrl)
        setQrCodeUrl(qr)
      }

      setPaymentId(data.paymentId)

    }catch(err){
      setStatus("failed")
    }
  }

  return (
    <div className="flex flex-col items-center">

      <div className="bg-white rounded-2xl shadow-lg p-6 w-[400px]">

        {status === "ready" && (
          <>
            <AmountDisplay amount={subtotal} />
            <Keypad digits={digits} setDigits={setDigits} />

            <button
              onClick={()=>setStatus("confirm")}
              className="w-full bg-blue-600 text-white mt-4 py-3 rounded-md"
            >
              Charge
            </button>
          </>
        )}

        {status === "confirm" && (
          <div className="text-center">
            <div className="text-xl mb-4">${subtotal}</div>

            <button
              onClick={createPayment}
              className="bg-blue-600 text-white px-6 py-3 rounded-md"
            >
              Pay
            </button>
          </div>
        )}

        {(status === "waiting" || status === "processing") && (
          <div className="text-center">
            {qrCodeUrl && (
              <Image src={qrCodeUrl} width={200} height={200} alt="QR" />
            )}

            <div className="mt-4">
              {status === "waiting" && "Waiting for payment..."}
              {status === "processing" && "Processing..."}
            </div>
          </div>
        )}

        {status === "confirmed" && (
          <div className="text-green-600 text-center">
            <CheckCircle size={60} />
            Payment Confirmed
          </div>
        )}

        {status === "failed" && (
          <div className="text-red-600 text-center">
            <XCircle size={60} />
            Payment Failed
          </div>
        )}

      </div>

    </div>
  )
}