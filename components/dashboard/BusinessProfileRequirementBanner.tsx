import Link from "next/link"

type BusinessProfileReturnDestination = "overview" | "wallet" | "providers"

export function businessProfileDeepLink(returnDestination: BusinessProfileReturnDestination) {
  return `/dashboard/settings?section=business-profile&return=${returnDestination}`
}

export default function BusinessProfileRequirementBanner({
  message,
  returnDestination,
  compact = false,
}: {
  message: string
  returnDestination: BusinessProfileReturnDestination
  compact?: boolean
}) {
  return (
    <div className={`rounded-lg border border-red-200 bg-red-50/70 text-sm shadow-none ${compact ? "px-3 py-2" : "px-3 py-2.5"}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="h-4 w-1 shrink-0 rounded-full bg-red-500" />
        <p className="min-w-0 flex-1 font-semibold leading-5 text-red-950">{message}</p>
        <Link
          href={businessProfileDeepLink(returnDestination)}
          className="inline-flex min-h-8 shrink-0 items-center justify-center rounded-lg bg-red-600 px-3 text-xs font-semibold text-white transition hover:bg-red-700"
        >
          Complete Business Profile
        </Link>
      </div>
    </div>
  )
}
