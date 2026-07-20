import Link from "next/link"
import { X } from "lucide-react"
import {
  DashboardSection,
  ProviderStatusPill,
  dashboardPageTitleClass,
  dashboardSupportingTextClass,
} from "@/components/dashboard/DashboardPrimitives"
import { modalCloseButtonClass } from "@/components/ui/ModalCloseButton"

export default function DeveloperSdksPage() {
  return (
    <div className="space-y-5 md:space-y-7">
      <div className="relative pr-12">
        <Link
          href="/dashboard/developer"
          aria-label="Close SDKs panel"
          className={`absolute right-0 top-0 ${modalCloseButtonClass}`}
        >
          <X size={18} />
        </Link>
        <h1 className={dashboardPageTitleClass}>SDKs</h1>
        <p className={`mt-1 max-w-2xl ${dashboardSupportingTextClass}`}>
          Review supported API surfaces, package names, and installation commands.
        </p>
      </div>

      <SdkCards />
    </div>
  )
}

function SdkCards() {
  const cards = [
    {
      title: "REST API",
      status: "Ready",
      tone: "green" as const,
      purpose: "Connect directly from your server.",
      command: null as string | null,
      description: "No package required. Use a secret API key from your server to create checkout sessions.",
    },
    {
      title: "Node SDK",
      status: "Ready",
      tone: "green" as const,
      purpose: "Server tools for checkout and webhooks.",
      command: "npm install @pinetreepayments/node",
      description: "Use this on your server for checkout sessions, payments, and webhook verification.",
    },
    {
      title: "JavaScript SDK",
      status: "Ready",
      tone: "green" as const,
      purpose: "Start checkout from a website.",
      command: "npm install @pinetreepayments/js",
      description: "Use this in browser checkout flows with a public browser key.",
    },
    {
      title: "React SDK",
      status: "Ready",
      tone: "green" as const,
      purpose: "Add checkout to a React app.",
      command: "npm install @pinetreepayments/react",
      description: "Use this in React apps for checkout buttons and embedded checkout.",
    },
  ]

  return (
    <DashboardSection title="SDKs & API" titleTone="blue">
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <details key={card.title} className="group rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
            <summary className="cursor-pointer list-none">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-gray-950">{card.title}</h2>
                  <p className="mt-1 text-xs leading-5 text-gray-500">{card.purpose}</p>
                </div>
                <ProviderStatusPill label={card.status} tone={card.tone} />
              </div>
              <span className="mt-3 inline-flex text-xs font-semibold text-blue-700 group-open:hidden">View setup</span>
            </summary>
            <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
              {card.command && (
                <code className="block overflow-x-auto rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-mono text-[11px] font-medium text-gray-950 shadow-[0_4px_14px_rgba(15,23,42,0.04)]">
                  {card.command}
                </code>
              )}
              <p className="text-xs text-gray-600">{card.description}</p>
            </div>
          </details>
        ))}
      </div>
    </DashboardSection>
  )
}
