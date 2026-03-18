export default function POSTerminalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gray-100 relative overflow-hidden">

      {/* TOP RIGHT STATUS */}
      <div className="absolute top-8 right-10 text-blue-600 font-semibold text-sm">
        Unlocked
      </div>

      {children}

    </div>
  )
}