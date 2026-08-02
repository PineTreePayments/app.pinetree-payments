# Shift4 merchant onboarding boundary

PineTree does not underwrite or approve merchants. The intended flow is provider settings → PineTree starts a Shift4 application session → the applicant submits directly in Shift4's hosted/embedded experience → PineTree records a verified, sanitized status update → readiness evaluates approval, certification, and explicit enablement separately.

PineTree stores merchant/connection/application/session identifiers, a safe launch reference or HTTPS URL, provider status/reason code, correlation/update identities, and operational timestamps. It does not store SSNs, bank details, ownership documents, application bodies, email bodies, attachments, or provider credentials.

The real start/update adapters remain fail-closed until Shift4 answers: hosted/embedded contract; session request/result; application identifier; status query; outbound submission requirements; bucket inbox/authentication; reply subject/body/attachment format; sensitive-data content; status vocabulary; and webhook availability/verification. The structured-email adapter stores only a message digest, sender allowlist result, safe extracted identifiers/status hints, attachment count, and manual-review decision.

The admin fixture console demonstrates the complete approved progression plus declined, canceled, blocked, and error states. Its structured-email fixtures cover trusted, untrusted, duplicate, missing-correlation, and attachment-metadata cases. All content is synthetic; no mailbox is accessed and no attachment, identity, tax, ownership, or banking content is persisted.
