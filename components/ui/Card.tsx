type Props = {
  children: React.ReactNode
  className?: string
  padding?: boolean
}

export default function Card({ children, className = "", padding = true }: Props) {
  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-gray-200 ${padding ? "p-6" : ""} ${className}`}>
      {children}
    </div>
  )
}
