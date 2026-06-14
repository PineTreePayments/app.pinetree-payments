import { ExternalLink } from "lucide-react"
import { ProviderStatusPill } from "@/components/dashboard/DashboardPrimitives"

const pluginFolderUrl =
  "https://github.com/PineTreePayments/app.pinetree-payments/tree/main/plugins/woocommerce-pinetree"

const setupSteps = [
  "Install and activate the PineTree WooCommerce plugin in a test store.",
  "Add a PineTree secret API key in the payment settings.",
  "Add the webhook signing secret.",
  "Copy the Webhook URL shown by the plugin into PineTree Developer > Webhooks.",
  "Place a test order with PineTree selected at checkout.",
  "Confirm the customer is redirected to PineTree Checkout.",
  "Confirm the signed webhook updates the WooCommerce order.",
  "Send the same event again and confirm it does not duplicate notes or status changes.",
  "Use Manual sync on the order if a delivery needs to be checked again.",
]

export default function WooCommerceIntegrationCard() {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-950">WooCommerce</h2>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            Install the private plugin in a WooCommerce test store to validate checkout and webhooks.
          </p>
        </div>
        <ProviderStatusPill label="Ready for install testing" tone="blue" />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a
          href={pluginFolderUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 transition hover:border-blue-200 hover:text-blue-700"
        >
          Open plugin folder
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>

      <details id="woocommerce-setup-guide" className="mt-4 border-t border-gray-100 pt-3 sm:mt-auto">
        <summary className="cursor-pointer list-none text-xs font-semibold text-blue-700">
          View setup guide
        </summary>
        <ol className="mt-3 space-y-2 pl-4 text-xs leading-5 text-gray-600">
          {setupSteps.map((step) => (
            <li key={step} className="list-decimal pl-1">
              {step}
            </li>
          ))}
        </ol>
        <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-600">
          The plugin shows the exact store webhook URL in WooCommerce settings. It follows the format{" "}
          <code className="font-mono text-[11px] text-gray-800">
            https://your-store.com/?wc-api=pinetree_webhook
          </code>
          .
        </p>
      </details>
    </div>
  )
}
