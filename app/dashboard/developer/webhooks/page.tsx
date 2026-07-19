import Link from "next/link"
import { CheckoutWorkspace } from "../../checkout/page"
import {
  dashboardPageTitleClass,
  dashboardSupportingTextClass,
} from "@/components/dashboard/DashboardPrimitives"

export default function DeveloperWebhooksPage() {
  return (
    <div className="space-y-5 md:space-y-7">
      <div>
        <Link href="/dashboard/developer" className="text-sm font-semibold text-blue-700 hover:text-blue-800">
          Back to Developer
        </Link>
        <h1 className={`mt-2 ${dashboardPageTitleClass}`}>Webhooks</h1>
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
