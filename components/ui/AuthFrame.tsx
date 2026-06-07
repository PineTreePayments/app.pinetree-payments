import Image from "next/image"
import type { ReactNode } from "react"

export default function AuthFrame({
  title,
  subtitle,
  children
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_15%_15%,rgba(139,92,246,0.18),transparent_28%),radial-gradient(circle_at_85%_20%,rgba(22,82,240,0.22),transparent_30%),linear-gradient(180deg,#edf4ff_0%,#f8faff_52%,#ffffff_100%)] px-4 py-8">
      <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(22,82,240,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(22,82,240,0.05)_1px,transparent_1px)] [background-size:48px_48px]" />
      <section className="relative w-full max-w-md rounded-[1.75rem] border border-white/80 bg-white/90 p-5 shadow-[0_30px_100px_rgba(15,23,42,0.16)] backdrop-blur-2xl sm:p-8">
        <div className="mb-6">
          <div className="mb-5 flex items-center justify-between">
            <Image src="/pinetree-web-logo.png" alt="PineTree Payments" width={112} height={42} priority />
            <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700">
              Merchant
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-slate-950">{title}</h1>
          <p className="mt-1.5 text-sm leading-6 text-slate-600">{subtitle}</p>
        </div>
        {children}
        <div className="mt-6 grid grid-cols-3 gap-2 border-t border-slate-100 pt-5 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          <span>Secure</span>
          <span>Auditable</span>
          <span>Merchant-first</span>
        </div>
      </section>
    </main>
  )
}
