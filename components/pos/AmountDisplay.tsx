"use client"

type Props = {
  amount: string
}

export default function AmountDisplay({ amount }: Props) {

  return (
    <div className="text-4xl font-semibold text-gray-900 text-center w-full py-2">
      ${amount}
    </div>
  )

}