type Props = {
  label: string
  classes?: string
}

export default function StatusBadge({ label, classes = "bg-gray-100 text-gray-700" }: Props) {
  return (
    <span className={`inline-flex min-h-6 items-center rounded-full border border-current/10 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${classes}`}>
      {label}
    </span>
  )
}
