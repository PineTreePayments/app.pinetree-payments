# ROLE: Webhook

## Flow
verify → translate → processPaymentEvent

## Responsibilities
- Verify webhook
- Translate provider event
- Send to engine

## Rules
- NEVER update DB directly
- NEVER bypass engine

## Output
await processPaymentEvent(event)