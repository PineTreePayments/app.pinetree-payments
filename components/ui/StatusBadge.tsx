type Props = {
  label: string
  classes?: string
}

export default function StatusBadge({ label, classes = "bg-gray-100 text-gray-700" }: Props) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${classes}`}>
      {label}
    </span>
  )
}
