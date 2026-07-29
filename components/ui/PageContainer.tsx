type Props = {
  children: React.ReactNode
  className?: string
}

export default function PageContainer({ children, className = "" }: Props) {
  return (
    <main className={`min-h-screen flex items-center justify-center bg-gray-50 p-6 ${className}`}>
      {children}
    </main>
  )
}
