# ROLE: Providers

## Responsibilities
- Call external APIs
- Translate responses

## Rules
- NEVER update DB
- NEVER calculate fees
- NEVER contain business logic

## Output Example
return {
  type: "payment.confirmed",
  paymentId
}