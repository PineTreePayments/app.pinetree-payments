"use client"

/**
 * PineTree review-and-consent step.
 *
 * This is the final step of PineTree's own onboarding: the merchant reviews
 * what PineTree does with their information and knowingly accepts the service
 * terms. PineTree creates NO infrastructure-partner customer until this
 * succeeds.
 *
 * DISCLOSURE: this is one of the few places an infrastructure partner is named,
 * because naming it here is the required provider disclosure. Everywhere else
 * the merchant sees PineTree.
 *
 * The card disappears once consent is recorded - it is a step, not a setting.
 */

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabaseClient"
import { primaryActionButtonClass } from "@/components/ui/PrimaryActionButton"

type TermsDisclosure = {
  version: string
  summary: string[]
  providers: { name: string; role: string; termsUrl: string }[]
}

type VerificationSummary = {
  status: string
  profileComplete: boolean
  termsAccepted: boolean
}

type ApiResponse = {
  ok?: boolean
  data?: { verification?: VerificationSummary; terms?: TermsDisclosure }
  error?: { message?: string }
}

export default function ServiceTermsConsentCard({ onAccepted }: { onAccepted?: () => void }) {
  const [terms, setTerms] = useState<TermsDisclosure | null>(null)
  const [verification, setVerification] = useState<VerificationSummary | null>(null)
  const [checked, setChecked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState("")

  const authorizedFetch = useCallback(async (path: string, init: RequestInit = {}) => {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) throw new Error("Please sign in again")

    const res = await fetch(`/api/onboarding/business-verification${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      credentials: "include",
      cache: "no-store",
    })
    const payload = (await res.json().catch(() => null)) as ApiResponse | null

    if (!res.ok || !payload?.ok) {
      throw new Error(payload?.error?.message || "Something went wrong. Please try again.")
    }
    return payload
  }, [])

  const load = useCallback(async () => {
    try {
      const payload = await authorizedFetch("")
      setTerms(payload.data?.terms || null)
      setVerification(payload.data?.verification || null)
      setErrorMessage("")
    } catch {
      // Silent: the consent step simply does not render if it cannot load.
      setTerms(null)
    } finally {
      setLoading(false)
    }
  }, [authorizedFetch])

  useEffect(() => {
    void load()
  }, [load])

  async function accept() {
    if (!terms || !checked) return

    setSubmitting(true)
    setErrorMessage("")
    try {
      // The version PineTree displayed is echoed back, so the Engine can
      // refuse consent recorded against text the merchant never saw.
      const payload = await authorizedFetch("/consent", {
        method: "POST",
        body: JSON.stringify({ accepted: true, termsVersion: terms.version }),
      })
      setVerification(payload.data?.verification || null)
      toast.success("Thanks — PineTree is verifying your business.")
      onAccepted?.()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to record your acceptance.")
    } finally {
      setSubmitting(false)
    }
  }

  // The step only applies once the profile is complete and consent is still
  // outstanding. Anything else means there is nothing for the merchant to do.
  if (loading || !terms || !verification) return null
  if (!verification.profileComplete || verification.termsAccepted) return null

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-3 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-3.5">
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-gray-950">Review and continue</p>
          <p className="mt-1 text-sm leading-5 text-gray-600">
            One last step before PineTree can verify your business and activate wallet and
            settlement capabilities.
          </p>
        </div>

        <ul className="space-y-1.5">
          {terms.summary.map((line) => (
            <li key={line} className="flex gap-2 text-sm leading-5 text-gray-700">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-blue-500" />
              <span className="min-w-0">{line}</span>
            </li>
          ))}
        </ul>

        {terms.providers.length > 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Service providers
            </p>
            {terms.providers.map((provider) => (
              <p key={provider.name} className="mt-1 text-xs leading-5 text-gray-700">
                <span className="font-semibold text-gray-900">{provider.name}</span> — {provider.role}
                {" · "}
                <a
                  href={provider.termsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-800"
                >
                  Terms
                </a>
              </p>
            ))}
          </div>
        ) : null}

        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm leading-5 text-gray-800">
            I am authorized to act for this business, and I accept the PineTree terms and the
            service-provider terms above.
          </span>
        </label>

        {errorMessage ? (
          <p role="alert" className="text-xs font-medium text-red-600">
            {errorMessage}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void accept()}
          disabled={!checked || submitting}
          className={`${primaryActionButtonClass} disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {submitting ? "Submitting..." : "Accept and continue"}
        </button>
      </div>
    </div>
  )
}
