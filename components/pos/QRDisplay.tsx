"use client"

import Image from "next/image"

type Props = {
  qrCodeUrl?: string
  paymentUrl?: string
  onCancel?: () => void
}

export default function QRDisplay({
  qrCodeUrl,
  paymentUrl,
  onCancel
}: Props) {

  if(!qrCodeUrl){
    return null
  }

  const canOpenWallet = Boolean(
    paymentUrl &&
    (
      paymentUrl.startsWith("ethereum:") ||
      paymentUrl.startsWith("metamask:") ||
      paymentUrl.startsWith("cbwallet:")
    )
  )

  function openWallet(){
    if(canOpenWallet && paymentUrl){
      window.open(paymentUrl, "_blank")
    }
  }

  return (

    <div className="flex flex-col items-center">

      <div className="text-sm text-gray-500 mb-3">
        Scan to Pay
      </div>

      <div
        className={`bg-white p-4 rounded-xl shadow transition ${canOpenWallet ? "cursor-pointer hover:scale-[1.02]" : ""}`}
        onClick={canOpenWallet ? openWallet : undefined}
      >

        <Image
          src={qrCodeUrl}
          width={220}
          height={220}
          alt="Payment QR"
        />

      </div>

      {canOpenWallet && (

        <button
          onClick={openWallet}
          className="mt-4 text-sm text-[#0052FF] font-medium hover:underline"
        >
          Open Wallet
        </button>

      )}

      {onCancel && (
        <button
          onClick={onCancel}
          className="mt-5 text-sm text-red-600 hover:text-red-700 font-medium"
        >
          Cancel Payment
        </button>
      )}

    </div>

  )

}
