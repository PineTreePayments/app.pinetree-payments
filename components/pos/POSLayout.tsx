"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { Loader2, CheckCircle, XCircle } from "lucide-react"
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

export default function POSLayout({ locked, terminalContext: terminalContextProp = null }: Props) {

  const [digits,setDigits] = useState("")
  const [connected,setConnected] = useState(false)
  const [connectionReason, setConnectionReason] = useState("")
  const [contextMerchantId, setContextMerchantId] = useState("")
  const [status,setStatus] = useState<Status>("ready")
  const [qrCodeUrl,setQrCodeUrl] = useState("")
  const [paymentId, setPaymentId] = useState("")
  const [terminalContext, setTerminalContext] = useState<{
    merchantId: string
    terminalId?: string
    provider?: string
  } | null>(terminalContextProp)

  useEffect(() => {
    setTerminalContext(terminalContextProp)
  }, [terminalContextProp])

  /* TAX SETTINGS */

  const [taxEnabled,setTaxEnabled] = useState(false)
  const [taxRate,setTaxRate] = useState(0)

  const subtotal = (Number(digits || "0") / 100).toFixed(2)

  const taxAmount = taxEnabled
    ? (Number(subtotal) * (taxRate / 100)).toFixed(2)
    : "0.00"

  const serviceFee = 0.15

  const total = (
    Number(subtotal) +
    Number(taxAmount) +
    serviceFee
  ).toFixed(2)

  useEffect(() => {
    if (!terminalContext?.merchantId) return
    const merchantId = terminalContext.merchantId

    async function loadPosData() {
      try {
        const qs = new URLSearchParams({ merchantId })
        if (terminalContext?.provider) {
          qs.set("provider", terminalContext.provider)
        }
        const res = await fetch(`/api/pos/payment?${qs.toString()}`, { cache: "no-store" })
        const data = await res.json().catch(() => null)

        if (!res.ok || !data) return

        setConnected(Boolean(data.connected))
        setConnectionReason(String(data.reason || ""))
        setContextMerchantId(String(data.context?.merchantId || ""))
        setTaxEnabled(Boolean(data.tax?.taxEnabled))
        setTaxRate(Number(data.tax?.taxRate || 0))
      } catch (err) {
        console.error("Failed loading POS payment metadata:", err)
      }
    }

    loadPosData()
    const interval = setInterval(loadPosData, 30000)

    return () => clearInterval(interval)
  }, [terminalContext])

  function resetSale(){

    setDigits("")
    setStatus("ready")
    setQrCodeUrl("")
    setPaymentId("")

  }

  useEffect(() => {
    if (!paymentId) return
    if (status !== "waiting" && status !== "processing") return

    let stopped = false

    async function pollStatus() {
      try {
        const qs = new URLSearchParams({ mode: "status", paymentId })
        const res = await fetch(`/api/pos/payment?${qs.toString()}`, { cache: "no-store" })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data || stopped) return

        const remote = String(data.status || "").toUpperCase()

        if (remote === "CREATED" || remote === "PENDING") {
          setStatus("waiting")
          return
        }

        if (remote === "PROCESSING") {
          setStatus("processing")
          return
        }

        if (remote === "CONFIRMED") {
          setStatus("confirmed")
          setTimeout(() => {
            if (!stopped) resetSale()
          }, 3500)
          return
        }

        if (remote === "FAILED") {
          setStatus("failed")
          return
        }

        if (remote === "INCOMPLETE" || remote === "EXPIRED") {
          setStatus("incomplete")
          return
        }
      } catch {
        // ignore transient poll errors
      }
    }

    pollStatus()
    const interval = setInterval(pollStatus, 2000)

    return () => {
      stopped = true
      clearInterval(interval)
    }
  }, [paymentId, status])

  async function createPayment(){

    if(!digits || Number(subtotal) <= 0){
      return
    }

    try{

      setStatus("waiting")

      const idempotencyKey = crypto.randomUUID()

      if(!terminalContext?.merchantId){
        setStatus("failed")
        return
      }

      const res = await fetch("/api/pos/payment",{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "idempotency-key": idempotencyKey
        },
        body:JSON.stringify({
          amount: Number(subtotal),
          currency:"USD",
          terminal: terminalContext
        })
      })

      const data = await res.json()

      if(!data.paymentId){
        setStatus("failed")
        return
      }

      if(data.qrCodeUrl){
        setQrCodeUrl(data.qrCodeUrl)
      }

      setPaymentId(String(data.paymentId || ""))

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
          <div className="space-y-1">
            <span className="text-red-600 text-sm font-medium block">
              Disconnected
            </span>
            {connectionReason ? (
              <span className="text-xs text-red-500 block">
                {connectionReason}
              </span>
            ) : null}
          </div>
        )}

        {contextMerchantId ? (
          <div className="text-[11px] text-gray-500 mt-1">
            MID: {contextMerchantId}
          </div>
        ) : null}

      </div>

      <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-8 w-[92vw] max-w-[440px]">

        {/* CONFIRM SCREEN */}

        {status === "confirm" && (

          <div className="text-center">

            <h2 className="text-lg font-semibold text-black mb-6">
              Confirm Payment
            </h2>

            <div className="space-y-3 text-black mb-6">

              <div className="flex justify-between text-lg">
                <span>Subtotal</span>
                <span className="font-medium">${subtotal}</span>
              </div>

              <div className="flex justify-between text-lg">
                <span>
                  Tax {taxEnabled ? `(${taxRate.toFixed(2)}%)` : "(disabled)"}
                </span>
                <span className="font-medium">${taxAmount}</span>
              </div>

              <div className="flex justify-between text-lg">
                <span>Service Fee</span>
                <span className="font-medium">${serviceFee.toFixed(2)}</span>
              </div>

              <div className="border-t my-3 border-gray-300"></div>

              <div className="flex justify-between font-semibold text-2xl text-black">
                <span>Total</span>
                <span>${total}</span>
              </div>

            </div>

            <div className="flex gap-4 justify-center">

              <button
                onClick={()=>setStatus("ready")}
                className="px-6 py-3 bg-gray-200 text-black rounded-md"
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

              <Image
                src={qrCodeUrl}
                width={220}
                height={220}
                alt="Payment QR"
                unoptimized
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

        {/* INCOMPLETE */}

        {status === "incomplete" && (

          <div className="flex flex-col items-center py-10">

            <XCircle
              size={70}
              className="text-orange-500"
            />

            <div className="mt-4 text-lg font-semibold text-orange-500">
              Payment Incomplete
            </div>

          </div>

        )}

        {/* AMOUNT ENTRY */}

        {status === "ready" && (

          <>
            <div className="mb-8 text-center">
              <AmountDisplay amount={subtotal} />
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