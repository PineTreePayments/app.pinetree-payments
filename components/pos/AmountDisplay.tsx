"use client"

type Props = {
  amount: string
}

export default function AmountDisplay({ amount }: Props) {

  return (
    <div className="text-4xl font-semibold text-black">
  ${amount}
</div>
  )

}