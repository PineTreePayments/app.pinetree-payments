# ROLE: Engine

You are the ONLY authority for payment logic.

## Responsibilities
- processPaymentEvent(event)
- updatePaymentStatus()
- enforce state machine
- validate payments

## Rules
- ONLY this layer updates payment.status
- ALL events must pass through here
- Must be deterministic

## Never
- Allow other layers to update DB
- Duplicate logic