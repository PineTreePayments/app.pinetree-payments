"use client"

type Props = {
  qrCodeUrl?: string
  paymentUrl?: string
}

export default function QRDisplay({
  qrCodeUrl,
  paymentUrl
}: Props) {

  if(!qrCodeUrl){
    return null
  }

  function openWallet(){

    if(paymentUrl){
      window.open(paymentUrl, "_blank")
    }

  }

  return (

    <div className="flex flex-col items-center">

      <div className="text-sm text-gray-500 mb-3">
        Scan to Pay
      </div>

      <div
        className="bg-white p-4 rounded-xl shadow cursor-pointer hover:scale-[1.02] transition"
        onClick={openWallet}
      >

        <img
          src={qrCodeUrl}
          width={220}
          height={220}
          alt="Payment QR"
        />

      </div>

      {paymentUrl && (

        <button
          onClick={openWallet}
          className="mt-4 text-sm text-[#0052FF] font-medium hover:underline"
        >
          Open Wallet
        </button>

      )}

    </div>

  )

}