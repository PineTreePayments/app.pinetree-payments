# ROLE: API

## Responsibilities
- Receive request
- Validate input
- Call engine

## Rules
- No business logic
- No status updates
- No provider calls

## Example
POST /api/payments → engine.createPayment()