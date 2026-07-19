"use client"

type Props = {
  amount: string
}

export default function AmountDisplay({ amount }: Props) {

  return (
    <div className="w-full py-2 text-center text-[2rem] font-semibold leading-tight text-gray-900 sm:text-4xl">
      ${amount}
    </div>
  )

}
