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



# 💰 PineTree Fee Model (STRICT)

## PURPOSE

Define how PineTree captures fees across ALL crypto payment rails while:

* Keeping frontend experience identical
* Enforcing fee capture at payment time
* Preventing post-payment collection
* Maintaining a non-custodial architecture (by default)

---

# 🔒 CORE RULE

```txt
PineTree MUST collect its fee at the time of payment.
```

❌ Post-payment fee collection is strictly prohibited
❌ Debiting merchant wallets after settlement is strictly prohibited

---

# 💵 PAYMENT AMOUNTS (MANDATORY)

Every payment MUST include:

```txt
merchant_amount
pinetree_fee
gross_amount = merchant_amount + pinetree_fee
```

Rules:

* MUST be calculated in engine
* MUST be stored in database
* MUST be immutable after creation
* MUST be used by all adapters

---

# 🖥️ FRONTEND STANDARD (LOCKED)

UI MUST ALWAYS display:

```txt
Subtotal
PineTree Fee
Total
```

Rules:

* Must look identical across all rails
* Must not vary by provider
* Must not hide or alter fee logic

---

# ⚙️ ENGINE AUTHORITY

ONLY the engine can:

* Calculate fees
* Define gross_amount
* Enforce fee rules
* Validate payment completion

UI MUST NOT:

* Calculate fees
* Override fee values

Providers MUST NOT:

* Calculate fees
* Override fee values

---

# 🔁 FEE EXECUTION MODES (STRICT ENUM)

All crypto rails MUST map to ONE of the following:

```ts
type FeeCaptureMethod =
  | "atomic_split"
  | "contract_split"
  | "invoice_split"
  | "collection_then_settle"
```

No other execution methods are allowed.

---

# 🌐 RAIL-SPECIFIC FEE STRUCTURE

## SOLANA

Execution Mode:

```txt
atomic_split
```

Implementation:

* Single transaction MUST include:

  * transfer → merchant_wallet
  * transfer → pinetree_wallet

Rules:

* One payment flow
* One signature
* No post-payment logic

Failure:

```txt
Missing PineTree transfer → FAILED
Underpayment → FAILED
```

---

## ETHEREUM / BASE (EVM)

Execution Mode:

```txt
contract_split
```

Implementation:

* Payment MUST go through PineTree split contract
* Contract MUST distribute:

  * merchant_amount → merchant_wallet
  * pinetree_fee → pinetree_wallet

Rules:

* Direct wallet transfer is NOT valid
* Fee must be enforced inside contract

Failure:

```txt
Direct transfer → FAILED
Missing fee distribution → FAILED
Underpayment → FAILED
```

---

## BITCOIN (L1)

Execution Mode:

```txt
atomic_split
```

Implementation:

* Transaction MUST include:

  * output → merchant_wallet
  * output → pinetree_wallet

Rules:

* Both outputs must exist in same transaction

Failure:

```txt
Single-output transaction → FAILED
Missing fee output → FAILED
```

---

## LIGHTNING NETWORK

Execution Mode:

```txt
invoice_split
```

Implementation:

* Invoice MUST equal gross_amount
* Fee embedded in invoice amount

Rules:

* No post-payment fee logic
* Fee must be included upfront

Failure:

```txt
Underpayment → FAILED
Fee not satisfied → FAILED
```

---

## COLLECTION MODE (DISABLED BY DEFAULT)

Execution Mode:

```txt
collection_then_settle
```

Implementation:

```txt
Customer → PineTree wallet (gross_amount)
PineTree → merchant wallet (merchant_amount)
```

Rules:

* Must be explicitly enabled
* Not default behavior
* Introduces custodial exposure

Default:

```txt
DISABLED
```

---

# ✅ CONFIRMATION RULE (CRITICAL)

A payment MUST NOT be marked CONFIRMED unless:

```txt
gross_amount received
AND
pinetree_fee captured
```

If NOT:

```txt
→ status = FAILED
```

---

# 🔍 FEE VALIDATION RULE

Engine MUST:

* Validate fee capture before confirmation
* Reject underpayments
* Reject missing fee transfers
* Enforce execution mode requirements

---

# 🚫 PROHIBITED BEHAVIOR

❌ Charging fee after payment
❌ Pulling funds from merchant wallets
❌ Allowing fee-less transactions
❌ Confirming partial payments
❌ Letting providers bypass fee enforcement
❌ Using different fee models per rail

---

# 🧠 DESIGN PRINCIPLE

PineTree standardizes:

* Fee calculation
* Payment intent
* Confirmation rules
* Ledger structure

Adapters handle:

* Rail-specific execution mechanics

---

# 🔥 FINAL RULE

```txt
A PineTree payment is ONLY valid if:
- merchant_amount is delivered
- pinetree_fee is captured
- both occur in the same payment flow
```

Otherwise:

```txt
→ Payment is NOT complete
```

---
