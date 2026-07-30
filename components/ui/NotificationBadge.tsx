"use client"

import { formatUnreadBadgeCount } from "@/lib/support/supportUnreadClient"

// PineTree standard unread-count badge (source of truth: the Help Center
// sidebar/mobile-navigation badge). Solid PineTree blue, white text, pill
// shaped, legible from 390px up. Counts above 99 render "99+" so the pill can
// never stretch the nav row.
export default function NotificationBadge({
  count,
  label,
  className = "",
}: {
  count: number
  label: string
  className?: string
}) {
  if (count <= 0) return null

  const display = formatUnreadBadgeCount(count)

  return (
    <span
      aria-label={`${count} ${label}`}
      className={`inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-[#0052FF] px-1.5 text-[11px] font-semibold leading-5 text-white shadow-sm ${className}`}
    >
      {display}
    </span>
  )
}
