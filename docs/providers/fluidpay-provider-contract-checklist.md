# FluidPay provider contract checklist

PineTree must receive authoritative FluidPay documentation or processor
confirmation for every item below before `FLUIDPAY_API_CONTRACT_VERIFIED` can
be enabled. This checklist intentionally contains no guessed values.

- Base sandbox and production API URLs.
- Authentication scheme and required headers.
- Token creation, expiration, rotation, and revocation lifecycle.
- Merchant/processor identifier format and account-scoping rules.
- Payment creation endpoint, request fields, amount units, and response shape.
- Hosted gateway and terminal contracts, including certification requirements.
- Payment status endpoint and complete status-to-lifecycle mapping.
- Webhook event list and versioning policy.
- Webhook signature header, signed payload, timestamp/replay rules, algorithm,
  and encoding.
- Idempotency-key support, scope, retention window, and duplicate semantics.
- Sandbox credentials and approved test cases.
- Production credentials, underwriting approval, and go-live certification.

Implementation belongs only in `providers/fluidpay/*`. Until the checklist is
complete, payment creation and status retrieval throw the explicit unverified-
contract error, webhook verification returns false, and merchant routing stays
disabled even if an application record says underwriting was approved.
