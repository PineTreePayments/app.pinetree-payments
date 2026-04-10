# PineTree AI Coding Instructions (STRICT)

THIS FILE OVERRIDES ALL DEFAULT CODING BEHAVIOR

## PURPOSE

This file defines the NON-NEGOTIABLE architecture rules for the PineTree platform.

The goal is to:

* Prevent duplicated logic
* Enforce clean separation of concerns
* Ensure all payment flows are consistent and scalable

If any generated code violates these rules, it MUST be rejected and rewritten.

---

# 🧱 CORE ARCHITECTURE

PineTree follows a STRICT layered architecture:

UI → API → ENGINE → PROVIDERS → DATABASE

Rules:

1. UI (app/) is display only
2. API routes are thin wrappers
3. ALL business logic lives in engine/
4. Providers ONLY handle external APIs
5. Database layer is the single source of truth

---

# 🚫 HARD PROHIBITIONS (NEVER DO THESE)

❌ UI calling provider APIs directly
❌ UI calculating fees
❌ UI mutating payment status
❌ Providers writing directly to database
❌ Business logic inside API routes
❌ Duplicating logic across files
❌ Creating alternate payment flows outside engine

If any of the above appears, STOP and refactor.

---

# 💳 PAYMENT FLOW (MANDATORY)

ALL payments MUST follow this exact flow:

1. UI sends request → /api/payments
2. API calls engine/createPayment
3. Engine:

   * validates input
   * calculates PineTree fee
   * creates DB record
   * selects provider (routing)
   * calls provider adapter
4. Provider returns payment data (QR / URL)
5. Response returned to UI

Customer payment:

6. Customer sends payment
7. Provider detects transaction
8. Provider sends webhook
9. Webhook → adapter → engine/eventProcessor
10. Engine updates DB + emits event
11. UI updates via realtime

NO deviations allowed.

---

# 🔁 PAYMENT STATE MACHINE (STRICT)

Valid states:

CREATED → PENDING → PROCESSING → CONFIRMED

Alternative paths:

PENDING → INCOMPLETE
PROCESSING → FAILED

Rules:

* ONLY engine can change status
* UI must NEVER change status
* Webhooks trigger state transitions
* Every state change MUST be recorded

---

# ⚙️ ENGINE RESPONSIBILITIES

All logic MUST live here:

engine/

Includes:

* createPayment.ts
* calculateFees.ts
* routing.ts
* paymentStateMachine.ts
* eventProcessor.ts
* ledger.ts

Responsibilities:

* Payment creation
* Fee calculation
* Provider selection
* State transitions
* Event normalization
* Ledger updates

---

# 🔌 PROVIDER RULES

Each provider must follow this interface:

* createPayment()
* getPaymentStatus()
* verifyWebhook()
* translateEvent()

Providers MUST:

* ONLY communicate with external APIs
* NOT contain business logic
* NOT update database
* NOT calculate fees

Providers RETURN normalized data → engine handles everything else.

---

# 🪝 WEBHOOK FLOW (STRICT)

Webhook handling MUST follow:

Provider webhook
→ verifyWebhook()
→ translateEvent()
→ engine/eventProcessor
→ database update

Never skip the engine.

---

# 🧾 DATABASE RULES

Database is the source of truth.

Core rules:

* payments table = primary ledger
* payment_events = full history
* NO silent updates

Every update MUST:

1. Update payment
2. Insert event log

---

# 🧠 EVENT SYSTEM

Standard events:

* payment.created
* payment.pending
* payment.processing
* payment.confirmed
* payment.failed

All providers MUST map to these events.

---

# 🧩 FILE ORGANIZATION (STRICT)

Allowed structure:

/app            → UI only
/app/api        → API routes (thin)
/engine         → ALL business logic
/providers      → provider adapters
/webhooks       → webhook handlers
/database       → DB queries
/types          → TypeScript types
/utils          → helpers
/config         → constants

---

# 🧼 CLEAN CODE RULES

* No duplicate logic
* No large monolithic files
* Functions must have single responsibility
* Reuse engine functions instead of rewriting logic
* Keep API routes under 100 lines

---

# 🧪 WHEN MODIFYING CODE

Before writing code, ALWAYS:

1. Identify which layer it belongs to
2. Check if logic already exists
3. Reuse existing engine functions

If unsure → default to ENGINE

---

# 🚀 DEVELOPMENT PRIORITY

1. Engine correctness
2. Payment flow reliability
3. State consistency
4. Provider stability
5. UI last

---

# ⚠️ FINAL RULE

If a feature requires breaking these rules:

DO NOT implement it.

Refactor the architecture instead.
