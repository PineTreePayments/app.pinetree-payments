import type { Viewport } from "next"

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
}

export default function POSTerminalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="pinetree-pos-terminal relative h-[100dvh] min-h-[100dvh] overflow-hidden overscroll-none bg-gray-100 touch-manipulation">

      {/* TOP RIGHT STATUS */}
      <div className="absolute right-[max(1rem,env(safe-area-inset-right))] top-[calc(env(safe-area-inset-top)+1rem)] text-sm font-semibold text-blue-600">
        Unlocked
      </div>

      {children}

    </div>
  )
}
