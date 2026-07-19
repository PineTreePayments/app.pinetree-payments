import Link from "next/link"
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
      <div>
        <Link href="/dashboard/developer" className="text-sm font-semibold text-blue-700 hover:text-blue-800">
          Back to Developer
        </Link>
        <h1 className={`mt-2 ${dashboardPageTitleClass}`}>Integrations</h1>
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
