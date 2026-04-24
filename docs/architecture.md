# PineTree Architecture (STRICT)

## Core Architecture

UI → API → ENGINE → PROVIDERS → DATABASE

---

## Layer Responsibilities

### UI (app/)
- Display only
- No business logic
- No fee calculation
- No status updates

### API (app/api/)
- Thin wrappers only
- Validate input
- Call engine
- No business logic

### ENGINE (/engine)
- Central brain
- Handles ALL payment logic
- Handles ALL state transitions
- Processes ALL events

### PROVIDERS (/providers)
- External API communication only
- Must NOT update DB
- Must NOT contain business logic

### DATABASE
- Source of truth
- payments.status is authoritative

---

## Payment Flow

1. UI → API
2. API → engine/createPayment
3. Engine:
   - validate
   - calculate fee
   - create DB record
   - route provider
   - call adapter
4. Provider returns payment data
5. UI displays QR

Customer payment:

6. Customer pays
7. Provider detects
8. Webhook triggered
9. Webhook → translateEvent
10. → engine/eventProcessor
11. → DB update

---

## State Machine

CREATED → PENDING → PROCESSING → CONFIRMED

Alternative:
- PENDING → INCOMPLETE
- PROCESSING → FAILED

---

## Critical Rules

- ONLY engine/eventProcessor updates status
- Watchers MUST NOT update DB
- Webhooks MUST NOT update DB
- Providers MUST NOT update DB
- UI MUST NOT update status
- No duplicate logic allowed
- No duplicate engine folders

---

## Event Flow (MANDATORY)

event → processPaymentEvent → updatePaymentStatus → DB

---

## Fee Model (Core Rules)

- Fee MUST be collected at payment time
- gross_amount = merchant_amount + pinetree_fee
- Payment is NOT valid unless fee is captured

---

## Final Rule

If implementation breaks architecture:

DO NOT implement — refactor instead.