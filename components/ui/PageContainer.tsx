type Props = {
  children: React.ReactNode
  className?: string
}

export default function PageContainer({ children, className = "" }: Props) {
  return (
    <main className={`min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-[#e0ecff] via-[#f5f8ff] to-white ${className}`}>
      {children}
    </main>
  )
}
