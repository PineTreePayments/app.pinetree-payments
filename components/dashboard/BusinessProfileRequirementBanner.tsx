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
  const linkedWord = "Continuing"
  const linkIndex = message.indexOf(linkedWord)
  const beforeLink = linkIndex >= 0 ? message.slice(0, linkIndex) : `${message} `
  const afterLink = linkIndex >= 0 ? message.slice(linkIndex + linkedWord.length) : ""

  return (
    <div className={`rounded-lg border border-red-200 bg-red-50/70 text-sm shadow-none ${compact ? "px-3 py-2" : "px-3 py-2.5"}`}>
      <div className="flex items-center gap-2">
        <span className="h-4 w-1 shrink-0 rounded-full bg-red-500" />
        <p className="min-w-0 flex-1 font-semibold leading-5 text-red-950">
          {beforeLink}
          <Link
            href={businessProfileDeepLink(returnDestination)}
            className="font-semibold text-red-700 underline decoration-red-300 underline-offset-2 hover:text-red-800 hover:decoration-red-500"
          >
            {linkIndex >= 0 ? linkedWord : "Continuing"}
          </Link>
          {afterLink}
        </p>
      </div>
    </div>
  )
}
