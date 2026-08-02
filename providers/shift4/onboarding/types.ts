export const SHIFT4_ONBOARDING_STATUSES = [
  "not_started", "draft", "application_started", "submitted", "received",
  "under_review", "more_information_required", "approved", "declined",
  "canceled", "blocked", "error",
] as const

export type Shift4OnboardingStatus = (typeof SHIFT4_ONBOARDING_STATUSES)[number]

export type Shift4OnboardingLaunch = Readonly<{
  providerApplicationId: string
  launchReference: string
  hostedApplicationUrl: string | null
  status: Shift4OnboardingStatus
  fixture: boolean
}>

export type Shift4OnboardingUpdate = Readonly<{
  providerApplicationId: string
  updateReference: string
  status: Shift4OnboardingStatus
  reasonCode: string | null
  occurredAt: string
  correlationId: string
  verified: boolean
  source: "fixture" | "structured_email" | "provider_api"
}>

export type Shift4StructuredEmailEnvelope = Readonly<{
  messageId: string
  senderDomain: string
  subject: string
  bodyText: string
  attachmentMetadata?: ReadonlyArray<Readonly<{ name: string; contentType: string; size: number }>>
}>
