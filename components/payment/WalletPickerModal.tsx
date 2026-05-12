"use client"

import type { ReactNode } from "react"

export type WalletPickerCard = {
  id: string
  name: string
  iconPath?: string
  icon?: ReactNode
  badgeLabel: string
  badgeTone?: "blue" | "green"
  active?: boolean
  disabled?: boolean
  spanAll?: boolean
  onSelect: () => void
}

export type WalletPickerSection = {
  title: string
  wallets: WalletPickerCard[]
}

type Props = {
  open: boolean
  title: string
  eyebrow: string
  searchValue: string
  searchPlaceholder?: string
  emptySearchMessage?: string
  notice?: ReactNode
  sections: WalletPickerSection[]
  onSearchChange: (value: string) => void
  onClose: () => void
}

function WalletIcon({ wallet }: { wallet: WalletPickerCard }) {
  return (
    <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#0f172a] shadow-[0_12px_28px_rgba(0,0,0,0.28)] ring-1 ring-white/15 transition group-hover:scale-[1.03]">
      {wallet.iconPath ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={wallet.iconPath} alt="" className="h-full w-full rounded-[18px] object-contain p-1.5" />
      ) : (
        wallet.icon
      )}
    </span>
  )
}

function renderSection(section: WalletPickerSection) {
  if (section.wallets.length === 0) return null

  return (
    <div className="space-y-3">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
        {section.title}
      </p>
      <div className="grid grid-cols-2 gap-3 min-[360px]:grid-cols-3 sm:grid-cols-4">
        {section.wallets.map((wallet) => (
          <button
            key={wallet.id}
            type="button"
            disabled={wallet.disabled}
            onClick={wallet.onSelect}
            className={`group flex min-h-[136px] flex-col items-center justify-between rounded-[22px] border px-2.5 py-3 text-center transition-all disabled:cursor-wait ${
              wallet.spanAll ? "col-span-2 min-[360px]:col-span-3 sm:col-span-4" : ""
            } ${
              wallet.active
                ? "border-[#3b82f6]/70 bg-[#10284d] shadow-[0_18px_44px_rgba(0,82,255,0.22)]"
                : "border-white/10 bg-[#151922] shadow-[0_14px_34px_rgba(0,0,0,0.22)] hover:-translate-y-0.5 hover:border-[#3b82f6]/55 hover:bg-[#1b2330] hover:shadow-[0_18px_44px_rgba(0,82,255,0.18)]"
            }`}
          >
            <span className="flex flex-col items-center gap-2">
              <WalletIcon wallet={wallet} />
              <span className="line-clamp-2 min-h-[34px] text-sm font-semibold leading-tight text-white">
                {wallet.name}
              </span>
            </span>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
              wallet.badgeTone === "green"
                ? "bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-300/20"
                : "bg-[#0052FF]/18 text-blue-200 ring-1 ring-blue-300/15"
            }`}>
              {wallet.badgeLabel}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function WalletPickerModal({
  open,
  title,
  eyebrow,
  searchValue,
  searchPlaceholder = "Search wallet",
  emptySearchMessage = "No wallets match your search.",
  notice,
  sections,
  onSearchChange,
  onClose,
}: Props) {
  if (!open) return null

  const hasResults = sections.some((section) => section.wallets.length > 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-md sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88svh] w-full flex-col overflow-hidden rounded-t-[30px] border border-white/10 bg-[#0b0f17] shadow-2xl shadow-black/60 sm:max-w-[520px] sm:rounded-[30px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-white/10 bg-[#0f1420] px-5 pb-4 pt-5 sm:px-6">
          <div className="relative flex items-center justify-center">
            <div className="text-center">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                {eyebrow}
              </p>
              <h2 className="mt-1 text-xl font-bold text-white">
                {title}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center rounded-full bg-white/8 text-slate-300 ring-1 ring-white/10 transition hover:bg-white/12 hover:text-white"
              aria-label="Close wallet picker"
            >
              x
            </button>
          </div>
          <div className="relative mt-5">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-500">
              Search
            </span>
            <input
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-12 w-full rounded-2xl border border-white/10 bg-[#171d28] px-4 pl-[72px] text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#3b82f6]/70 focus:ring-4 focus:ring-[#0052FF]/20"
              autoFocus
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 pb-[calc(env(safe-area-inset-bottom)+24px)] sm:px-6">
          {notice}
          {sections.map((section) => (
            <div key={section.title}>{renderSection(section)}</div>
          ))}
          {!hasResults ? (
            <div className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-400 ring-1 ring-white/10">
              {emptySearchMessage}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
