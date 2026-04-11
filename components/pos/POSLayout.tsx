"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { Loader2, CheckCircle, XCircle } from "lucide-react"
import QRCode from "qrcode"
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
  const [paymentError, setPaymentError] = useState("")
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
    setPaymentError("")

  }

  function requestCancelSale() {
    const confirmed = window.confirm("Are you sure you want to cancel this payment and go back?")
    if (!confirmed) return
    resetSale()
  }

  useEffect(() => {
    if (!paymentId) return

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
  }, [paymentId])

  async function createPayment(){

    if(!digits || Number(subtotal) <= 0){
      return
    }

    try{

      setPaymentError("")
      setStatus("waiting")

      const idempotencyKey = crypto.randomUUID()

      if(!terminalContext?.merchantId){
        setPaymentError("Missing terminal merchant context")
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

      const data = await res.json().catch(() => null)

      if(!res.ok || !data){
        setPaymentError(String(data?.error || "Failed to create payment"))
        setStatus("failed")
        return
      }

      if(!data.paymentId){
        setPaymentError("Payment response missing payment id")
        setStatus("failed")
        return
      }

      if(data.qrCodeUrl){
        setQrCodeUrl(data.qrCodeUrl)
      } else if (data.paymentUrl) {
        const generatedQr = await QRCode.toDataURL(String(data.paymentUrl))
        setQrCodeUrl(generatedQr)
      } else {
        setPaymentError("Payment response missing QR data")
        setStatus("failed")
        return
      }

      setPaymentId(String(data.paymentId || ""))

    }catch(err){

      console.error("Payment error:",err)
      setPaymentError(err instanceof Error ? err.message : "Payment creation failed")
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

        {/* QR + STATUS SCREEN */}

        {(status === "waiting" || status === "processing") && (

          <div className="flex flex-col items-center py-8">

            {status === "waiting" && (
              <>
                <div className="text-sm text-gray-500 mb-3">
                  {qrCodeUrl ? "Scan to Pay" : "Preparing QR..."}
                </div>

                {qrCodeUrl ? (
                  <div className="bg-white p-4 rounded-xl shadow">
                    <Image
                      src={qrCodeUrl}
                      width={220}
                      height={220}
                      alt="Payment QR"
                      unoptimized
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center py-6">
                    <Loader2 size={40} className="text-[#0052FF] animate-spin" />
                  </div>
                )}

                <div className="mt-4 flex items-center gap-3">
                  <div className="h-3 w-3 rounded-full bg-[#0052FF] animate-pulse shadow-lg shadow-[#0052FF]/60" />
                  <div className="text-sm text-gray-600 font-medium">
                    Waiting for payment
                  </div>
                </div>
              </>
            )}

            {status === "processing" && (
              <>
                <div className="bg-white p-4 rounded-xl shadow">
                  <Image
                    src={qrCodeUrl}
                    width={220}
                    height={220}
                    alt="Payment QR"
                    unoptimized
                    style={{ opacity: 0.5 }}
                  />
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <div className="h-4 w-4 rounded-full bg-amber-500 animate-pulse shadow-lg shadow-amber-500/60" />

                  <div>
                    <div className="text-gray-600 font-medium">
                      Processing Payment
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      Transaction detected on network
                    </div>
                  </div>
                </div>
              </>
            )}

            <button
              onClick={requestCancelSale}
              className="mt-5 text-sm text-red-600 hover:text-red-700 font-medium"
            >
              Cancel Payment
            </button>

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

            {paymentError ? (
              <div className="mt-2 text-sm text-red-500 text-center max-w-[320px]">
                {paymentError}
              </div>
            ) : null}

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