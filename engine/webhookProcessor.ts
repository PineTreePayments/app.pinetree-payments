/**
 * Legacy compatibility shim.
 * Canonical webhook processing contract now lives in engine/eventProcessor.ts
 */

export {
  processWebhook,
  processWebhooks,
  type WebhookInput
} from "./eventProcessor"