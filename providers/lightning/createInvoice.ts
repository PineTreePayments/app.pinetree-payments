import QRCode from "qrcode"
import type { CreateLightningInvoiceInput, CreateLightningInvoiceResult, LightningProviderConfig } from "./types"

export class LightningCapabilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LightningCapabilityError"
  }
}

export function assertLightningFeeCaptureSupported(config: LightningProviderConfig): void {
  const capabilities = config.capabilities

  if (!capabilities.supportsLightningInvoice) {
    throw new LightningCapabilityError("Lightning provider does not support invoice creation")
  }

  if (!capabilities.supportsFeeAtPaymentTime || !capabilities.supportsSplitSettlement) {
    throw new LightningCapabilityError(
      "Lightning provider does not support PineTree fee capture at payment time"
    )
  }
}

export async function createLightningInvoice(
  input: CreateLightningInvoiceInput,
  config: LightningProviderConfig
): Promise<CreateLightningInvoiceResult> {
  assertLightningFeeCaptureSupported(config)

  if (!config.apiBaseUrl) {
    throw new Error(
      "Lightning provider API is not configured. Select a PSP and wire its invoice endpoint before enabling Bitcoin Lightning."
    )
  }

  void input

  throw new Error(
    "Lightning provider invoice API integration is not implemented for this PSP yet"
  )
}

export async function buildLightningQrCode(invoice: string): Promise<string> {
  const normalizedInvoice = String(invoice || "").trim()
  const invoiceUri = normalizedInvoice.toLowerCase().startsWith("lightning:")
    ? normalizedInvoice
    : `lightning:${normalizedInvoice}`

  return QRCode.toDataURL(invoiceUri)
}
