/** Browser-safe i4Go contracts. They cannot represent PAN, CVV, or track data. */
export type Shift4I4GoBrowserConfig = Readonly<{
  configured: boolean
  scriptUrl: string | null
  iframeOrigin: string | null
  applicationId: string | null
  reason: string | null
}>

export type Shift4I4GoSession = Readonly<{
  sessionId: string
  completionSecret: string
  expiresAt: string
  browser: Shift4I4GoBrowserConfig
}>

export type Shift4I4GoTokenCallback = Readonly<{
  sessionId: string
  completionSecret: string
  cardToken: string
}>
