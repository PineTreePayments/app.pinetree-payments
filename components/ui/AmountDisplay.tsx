type Props = {
  label?: string
  amount: string
  subtext?: string
}

export default function AmountDisplay({ label, amount, subtext }: Props) {
  return (
    <div className="text-center">
      {label && (
        <p className="text-xs uppercase tracking-widest text-gray-500 mb-2">{label}</p>
      )}
      <p className="text-4xl font-bold text-gray-900">{amount}</p>
      {subtext && (
        <p className="text-sm text-gray-500 mt-1">{subtext}</p>
      )}
    </div>
  )
}
