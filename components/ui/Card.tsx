type Props = {
  children: React.ReactNode
  className?: string
  padding?: boolean
}

export default function Card({ children, className = "", padding = true }: Props) {
  return (
    <div className={`app-surface min-w-0 ${padding ? "p-4 sm:p-6" : ""} ${className}`}>
      {children}
    </div>
  )
}
