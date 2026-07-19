import Link from "next/link"
import { X } from "lucide-react"
import { CheckoutWorkspace } from "../../checkout/page"
import {
  dashboardPageTitleClass,
  dashboardSupportingTextClass,
} from "@/components/dashboard/DashboardPrimitives"

export default function DeveloperWebhooksPage() {
  return (
    <div className="space-y-5 md:space-y-7">
      <div className="relative pr-12">
        <Link
          href="/dashboard/developer"
          aria-label="Close webhooks panel"
          className="absolute right-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 active:scale-95 active:bg-gray-200"
        >
          <X size={18} strokeWidth={2.2} />
        </Link>
        <h1 className={dashboardPageTitleClass}>Webhooks</h1>
        <p className={`mt-1 max-w-2xl ${dashboardSupportingTextClass}`}>
          Manage endpoint delivery, event selection, signing secret handling, and recent delivery history.
        </p>
      </div>

      <CheckoutWorkspace
        mode="developer"
        showHeader={false}
        showNavigation={false}
        activeSection="webhooks"
        compactDeveloper
      />
    </div>
  )
}
