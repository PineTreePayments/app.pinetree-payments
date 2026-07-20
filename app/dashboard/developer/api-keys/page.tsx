import Link from "next/link"
import type { ReactNode } from "react"
import { X } from "lucide-react"
import { CheckoutWorkspace } from "../../checkout/page"
import {
  dashboardPageTitleClass,
  dashboardSupportingTextClass,
} from "@/components/dashboard/DashboardPrimitives"
import PublicKeysPanel from "../PublicKeysPanel"
import { modalCloseButtonClass } from "@/components/ui/ModalCloseButton"

export default function DeveloperApiKeysPage() {
  return (
    <div className="space-y-5 md:space-y-7">
      <div className="relative pr-12">
        <Link
          href="/dashboard/developer"
          aria-label="Close API keys panel"
          className={`absolute right-0 top-0 ${modalCloseButtonClass}`}
        >
          <X size={18} />
        </Link>
        <h1 className={dashboardPageTitleClass}>API Keys</h1>
        <p className={`mt-1 max-w-2xl ${dashboardSupportingTextClass}`}>
          Create and revoke server keys and browser-safe public keys for PineTree integrations.
        </p>
      </div>

      <div className="grid gap-2 rounded-2xl border border-blue-100 bg-blue-50/60 p-3 sm:grid-cols-2 sm:p-4">
        <KeyHelper title="Secret API keys" prefix="pt_live_*">
          Use these only on your server. They can create sessions, retrieve payments, and manage webhooks.
        </KeyHelper>
        <KeyHelper title="Public browser keys" prefix="pk_live_*">
          Use these on websites, checkout buttons, or React apps. They can start customer checkout sessions but cannot access private account data.
        </KeyHelper>
      </div>

      <CheckoutWorkspace
        mode="developer"
        showHeader={false}
        showNavigation={false}
        activeSection="developer"
        compactDeveloper
      />
      <PublicKeysPanel />
    </div>
  )
}

function KeyHelper({
  title,
  prefix,
  children,
}: {
  title: string
  prefix: string
  children: ReactNode
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-900">
        {title} <code className="font-mono text-[11px] text-blue-800">{prefix}</code>
      </p>
      <p className="mt-1 text-xs leading-5 text-gray-600">{children}</p>
    </div>
  )
}
