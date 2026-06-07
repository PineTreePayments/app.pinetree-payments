type Props = {
  children: React.ReactNode
  className?: string
}

export default function PageContainer({ children, className = "" }: Props) {
  return (
    <main className={`relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_15%_10%,rgba(139,92,246,0.14),transparent_28%),radial-gradient(circle_at_85%_20%,rgba(22,82,240,0.18),transparent_30%),linear-gradient(180deg,#edf4ff_0%,#f8faff_45%,#ffffff_100%)] p-3 sm:p-6 ${className}`}>
      {children}
    </main>
  )
}
