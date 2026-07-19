import Link from "next/link"
import { X } from "lucide-react"
import {
  DashboardSection,
  dashboardPageTitleClass,
  dashboardSupportingTextClass,
} from "@/components/dashboard/DashboardPrimitives"
import ShopifyIntegrationCard from "../ShopifyIntegrationCard"
import WooCommerceIntegrationCard from "../WooCommerceIntegrationCard"

export default function DeveloperIntegrationsPage() {
  return (
    <div className="space-y-5 md:space-y-7">
      <div className="relative pr-12">
        <Link
          href="/dashboard/developer"
          aria-label="Close integrations panel"
          className="absolute right-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 active:scale-95 active:bg-gray-200"
        >
          <X size={18} strokeWidth={2.2} />
        </Link>
        <h1 className={dashboardPageTitleClass}>Integrations</h1>
        <p className={`mt-1 max-w-2xl ${dashboardSupportingTextClass}`}>
          Connect supported commerce platforms and review available setup actions.
        </p>
      </div>

      <IntegrationCards />
    </div>
  )
}

function IntegrationCards() {
  return (
    <DashboardSection title="Commerce integrations" titleTone="blue">
      <div className="grid gap-3 sm:grid-cols-2">
        <WooCommerceIntegrationCard />
        <ShopifyIntegrationCard />
      </div>
    </DashboardSection>
  )
}
