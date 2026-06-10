export type Shift4DisplayStatus = {
  label: "Not connected" | "Pending" | "Connected"
  tone: "default" | "amber" | "blue"
}

type Shift4DisplayStatusInput = {
  providerStatus?: string | null
  accountReference?: string | null
  merchantApprovalStatus?: string | null
  apiStatus?: string | null
}

function normalized(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase()
}

function matchesStatus(value: string, statuses: string[]) {
  return statuses.some((status) => {
    const escaped = status.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(value)
  })
}

export function getShift4DisplayStatus(input: Shift4DisplayStatusInput): Shift4DisplayStatus {
  const providerStatus = normalized(input.providerStatus)
  const accountReference = normalized(input.accountReference)
  const merchantApprovalStatus = normalized(input.merchantApprovalStatus)
  const apiStatus = normalized(input.apiStatus)

  const rejected = [providerStatus, merchantApprovalStatus].some((value) =>
    matchesStatus(value, ["rejected", "declined", "denied"])
  )
  if (rejected) {
    return { label: "Not connected", tone: "default" }
  }

  const connected =
    matchesStatus(providerStatus, ["active", "connected"]) ||
    matchesStatus(merchantApprovalStatus, ["approved", "active"]) ||
    matchesStatus(apiStatus, ["live ready", "active"])
  if (connected) {
    return { label: "Connected", tone: "blue" }
  }

  const submitted =
    Boolean(accountReference) ||
    matchesStatus(merchantApprovalStatus, ["pending", "submitted", "awaiting"])
  if (submitted) {
    return { label: "Pending", tone: "amber" }
  }

  return { label: "Not connected", tone: "default" }
}
