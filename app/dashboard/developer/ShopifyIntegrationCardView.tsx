import { ProviderStatusPill } from "@/components/dashboard/DashboardPrimitives"

export type ShopifyStatus = {
  connected: boolean
  status: "connected" | "not_connected"
  shop: string | null
  connectedAt: string | null
  updatedAt: string | null
  configured: boolean
}

const setupSteps = [
  "Enter your Shopify store domain.",
  "Click Connect Shopify.",
  "Approve the PineTree app in Shopify.",
  "Return to PineTree.",
  "Confirm the store shows Connected.",
  "Create a test checkout once Shopify is enabled.",
  "Confirm checkout opens PineTree Checkout.",
  "Confirm order and webhook activity appears correctly.",
]

export function ShopifyIntegrationCardView({
  status,
  shop,
  loading,
  working,
  error,
  onShopChange,
  onConnect,
  onDisconnect,
}: {
  status: ShopifyStatus | null
  shop: string
  loading: boolean
  working: boolean
  error: string
  onShopChange: (shop: string) => void
  onConnect: () => void
  onDisconnect: () => void
}) {
  const connected = Boolean(status?.connected && status.shop)
  const unavailable = status?.configured === false

  return (
    <div className="flex h-full flex-col rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
      <div className="flex min-h-[4.5rem] items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-950">Shopify</h2>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            Connect a Shopify store to use PineTree Checkout.
          </p>
        </div>
        <ProviderStatusPill
          label={connected ? "Connected" : "Not connected"}
          tone={connected ? "blue" : "slate"}
        />
      </div>

      <div className="flex flex-1 flex-col pt-4">
        {loading ? (
          <p className="text-xs text-gray-500">Loading connection...</p>
        ) : connected && status?.shop ? (
          <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">
              Connected store
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-gray-900">{status.shop}</p>
            {status.connectedAt && (
              <p className="mt-1 text-xs text-gray-500">
                Connected {new Date(status.connectedAt).toLocaleString()}
              </p>
            )}
            <button
              type="button"
              onClick={onDisconnect}
              disabled={working}
              className="mt-3 inline-flex min-h-9 items-center justify-center rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 transition hover:border-red-200 hover:text-red-600 disabled:opacity-60"
            >
              {working ? "Disconnecting..." : "Disconnect"}
            </button>
          </div>
        ) : (
          <>
            <label className="text-[11px] font-semibold text-gray-700" htmlFor="shopify-store-domain">
              Store domain
            </label>
            <input
              id="shopify-store-domain"
              value={shop}
              onChange={(event) => onShopChange(event.target.value)}
              placeholder="mystore.myshopify.com"
              disabled={unavailable}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none transition placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
            />

            {unavailable && (
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-2.5">
                <p className="text-xs font-semibold text-gray-800">Connection unavailable</p>
                <p className="mt-1 text-xs leading-5 text-gray-500">
                  Shopify connection is not available yet. Contact PineTree support to enable Shopify.
                </p>
              </div>
            )}

            <div className="mt-auto pt-3">
              <button
                type="button"
                onClick={onConnect}
                disabled={working || !shop.trim() || unavailable}
                className="inline-flex min-h-9 items-center justify-center rounded-xl bg-blue-600 px-3.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {working ? "Connecting..." : "Connect Shopify"}
              </button>
            </div>
          </>
        )}

        {error && <p className="mt-3 text-xs leading-5 text-red-600">{error}</p>}
      </div>

      <details id="shopify-setup-guide" className="mt-4 border-t border-gray-100 pt-3">
        <summary className="cursor-pointer list-none text-xs font-semibold text-blue-700">
          View setup guide
        </summary>
        <div className="mt-3">
          <ol className="space-y-2 pl-4 text-xs leading-5 text-gray-600">
            {setupSteps.map((step) => (
              <li key={step} className="list-decimal pl-1">
                {step}
              </li>
            ))}
          </ol>
          <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-2.5">
            <p className="text-xs leading-5 text-gray-600">
              Shopify setup requires PineTree app credentials to be enabled in the deployment environment.
            </p>
          </div>
        </div>
      </details>
    </div>
  )
}
