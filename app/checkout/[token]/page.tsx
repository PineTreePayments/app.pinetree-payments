import { redirect } from "next/navigation"
import { resolveCheckoutLinkForCustomer } from "@/engine/checkoutLinks"

export const dynamic = "force-dynamic"

type Props = {
  params: Promise<{ token: string }>
}

export default async function CheckoutTokenPage({ params }: Props) {
  const { token: rawToken } = await params
  const token = decodeURIComponent(rawToken || "")

  if (!token) {
    return <CheckoutErrorScreen message="Invalid checkout link." />
  }

  let result: Awaited<ReturnType<typeof resolveCheckoutLinkForCustomer>>

  try {
    result = await resolveCheckoutLinkForCustomer(token)
  } catch {
    return <CheckoutErrorScreen message="Unable to load this checkout link. Please try again." />
  }

  if (!result) {
    return <CheckoutErrorScreen message="This checkout link does not exist." />
  }

  if (result.resolvedStatus === "disabled") {
    return <CheckoutErrorScreen message="This checkout link has been deactivated by the merchant." cancelUrl={result.cancelUrl} />
  }

  if (result.resolvedStatus === "expired") {
    return <CheckoutErrorScreen message="This checkout link has expired." cancelUrl={result.cancelUrl} />
  }

  if (!result.intentId) {
    return <CheckoutErrorScreen message="Unable to prepare this payment. Please try again." />
  }

  const payUrl = new URL("/pay", "https://placeholder.invalid")
  payUrl.searchParams.set("intent", result.intentId)
  if (result.successUrl) payUrl.searchParams.set("success_url", result.successUrl)
  if (result.cancelUrl) payUrl.searchParams.set("cancel_url", result.cancelUrl)

  redirect(`/pay?${payUrl.searchParams.toString()}`)
}

function CheckoutErrorScreen({
  message,
  cancelUrl,
}: {
  message: string
  cancelUrl?: string | null
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-white via-[#f8fbff] to-[#edf5ff] px-4">
      <div className="w-full max-w-sm rounded-3xl border border-gray-200/80 bg-white p-8 shadow-[0_18px_60px_rgba(15,23,42,0.10)] text-center space-y-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">
          PineTree Checkout
        </p>
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-red-200 bg-red-50">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-red-500">
            <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900">Link Unavailable</h1>
        <p className="text-sm text-gray-500 leading-relaxed">{message}</p>
        {cancelUrl && (
          <a
            href={cancelUrl}
            className="inline-block rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:border-[#0052FF]/30 hover:text-[#0052FF]"
          >
            Return to Store
          </a>
        )}
      </div>
    </div>
  )
}
